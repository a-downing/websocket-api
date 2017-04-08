import { WebSocket, Server as WebSocketServer } from 'ws'
import _ from 'underscore'

export class WebSocketApiServerConnection {
    constructor(webSocketApiServer, clientId, connection) {
        this.webSocketApiServer = webSocketApiServer
        this.clientId = clientId
        this.connection = connection
        this.requests = new Map()
        this.freeRequestIds = new Set()
        this.requestMethods = new Map()

        this.sess = {}

        this.connection.on('close', () => {
            this.onClose()
        })

        this.connection.on('error', (err) => {
            this.onError(err)
        })

        this.connection.on('message', (message) => {
            try {
                let msg = JSON.parse(message)

                if(!_.has(msg, 'type')) {
                    throw new Error('missing message type')
                } else {
                    if(Object.prototype.toString.call(msg.type) != '[object String]') {
                        throw new Error('invalid message type')
                    } else if(_.contains(['request', 'response'], msg.type)) {
                        if(!_.has(msg, 'id')) {
                            throw new Error('missing message id')
                        } else {
                            if(Object.prototype.toString.call(msg.id) != '[object Number]' || !Number.isInteger(msg.id)) {
                                throw new Error('invalid message id')
                            }
                        }
                    }
                }

                if(!_.has(msg, 'name')) {
                    throw new Error('missing message name')
                } else {
                    if(Object.prototype.toString.call(msg.type) != '[object String]') {
                        throw new Error('invalid message name')
                    }
                }

                this.onMessage(msg)
            } catch(err) {
                this.onError(err)
            }
        })
    }

    getSession() {
        return this.sess
    }

    getServer() {
        return this.webSocketApiServer
    }

    _getFreeRequestId() {
        let requestId

        if(this.freeRequestIds.size == 0) {
            requestId = this.requests.size
        } else {
            requestId = this.freeRequestIds[Symbol.iterator]().next().value
            this.freeRequestIds.delete(requestId)
        }

        return requestId
    }

    _freeRequest(requestId) {
        this.requests.delete(requestId)
        this.freeRequestIds.add(requestId)
    }

    close() {
        this.connection.close()
    }

    sendRequest(name, data) {
        return new Promise((resolve, reject) => {
            let requestId = this._getFreeRequestId()

            let msg = {
                type: 'request',
                name: name,
                id: requestId,
                data: data
            }

            this.requests.set(requestId, {
                resolve: resolve,
                reject: reject
            })

            try {
                this.onSend(msg)
            } catch(err) {
                this.onError(err)
            }

            try {
                this.connection.send(JSON.stringify(msg))
            } catch(err) {
                this.requests.delete(requestId)
                reject(err)
            }
        })
    }

    _sendResponse(name, id, status, data) {
        try {
            let msg = {
                type: 'response',
                name: name,
                id: id,
                status: status,
                data: data
            }

            try {
                this.onSend(msg)
            } catch(err) {
                this.onError(err)
            }

            this.connection.send(JSON.stringify(msg))
        } catch(err) {
            this.onError(err)
        }
    }

    registerRequestMethod(name, method) {
        this.requestMethods.set(name, method)
    }

    getConnectionId() {
        return this.clientId
    }

    onClose() {
        for(let request of this.requests.values()) {
            request.reject(new Error('WebSocket closed'))
        }

        this.getServer().onWebSocketClose(this)
    }

    onError(err) {
        console.error(err)
        this.getServer().onWebSocketError(this, err)
    }

    onSend(msg) {
        this.getServer().onWebSocketSend(this, msg)
    }

    onMessage(msg) {
        this.getServer().onMessage(this, msg)

        if(msg.type == 'response') {
            if(!this.requests.has(msg.id)) {
                this.onError(new Error('matching request id does not exist'))
            } else {
                if(msg.status == 'resolve') {
                    this.requests.get(msg.id).resolve(msg.data)    
                } else if(msg.status == 'reject') {
                    this.requests.get(msg.id).reject(msg.data)    
                }

                this._freeRequest(msg.id)
            }
        } else if(msg.type == 'request') {
            this.onRequest(msg)
        }
    }

    onRequest(msg) {
        if(!this.getServer().requestMethods.has(msg.name)) {
            this.onError(new Error('request method does not exist'))
        } else {
            this.getServer().requestMethods.get(msg.name)(this, msg.data).then((result) => {
                this._sendResponse(msg.name, msg.id, 'resolve', result)
            }).catch((err) => {
                this._sendResponse(msg.name, msg.id, 'reject', err.toString())
            })
        }
    }
}

export class WebSocketApiServer {
    constructor(options) {
        this.webSocketServer = new WebSocketServer(options)
        this.clients = new Map()
        this.freeClientIds = new Set()
        this.requestMethods = new Map()
        this.eventCallbacks = new Map()
        this.eventCallbackSymbols = new Map()

        this.webSocketServer.on('connection', (connection) => {
            let clientId = this.getFreeConnectionId()
            let webSocketConnection = new WebSocketApiServerConnection(this, clientId, connection)
            this.clients.set(clientId, webSocketConnection)

            try {
                this._execEventCallbacks('open', webSocketConnection)
            } catch(err) {
                this.onError(err)
            }
        })

        this.webSocketServer.on('error', (err) => {
            this.onError(err)
        })
    }

    onError(err) {
        console.error(err)
        
        try {
            this._execEventCallbacks('error', err)
        } catch(err) {
            // a callback is the source of the error, don't call it again
            console.error(err)
        }
    }

    on(event, callback) {
        let sym = Symbol('event callback symbol')

        if(!this.eventCallbacks.has(event)) {
            this.eventCallbacks.set(event, new Map())
        }

        this.eventCallbacks.get(event).set(sym, callback)
        this.eventCallbackSymbols.set(sym, event)

        return sym
    }

    off(sym) {
        let event = this.eventCallbackSymbols.get(sym)
        this.eventCallbacks.get(event).delete(sym)
    }

    _execEventCallbacks(event, ...args) {
        if(this.eventCallbacks.has(event)) {
            for(let [sym, _cb] of this.eventCallbacks.get(event)) {
                _cb(...args)
            }
        }
    }

    registerRequest(name, method) {
        this.requestMethods.set(name, method)
    }

    _getFreeRequestId() {
        let requestId

        if(this.freeRequestIds.size == 0) {
            requestId = this.requests.size
        } else {
            requestId = this.freeRequestIds[Symbol.iterator]().next().value
            this.freeRequestIds.delete(requestId)
        }

        return requestId
    }

    getConnections() {
        return this.clients
    }

    getConnection(id) {
        return this.clients.get(id)
    }

    getConnectionsIds() {
        return this.clients.keys()
    }

    getFreeConnectionId() {
        let clientId

        if(this.freeClientIds.size == 0) {
            clientId = this.clients.size
        } else {
            clientId = this.freeClientIds[Symbol.iterator]().next().value
            this.freeClientIds.delete(clientId)
        }

        return clientId
    }

    freeConnection(con) {
        let id = con.getConnectionId()
        this.clients.delete(id)
        this.freeClientIds.add(id)
    }

    onWebSocketMessage(con, message) {
        try {
            this._execEventCallbacks('message', con, message)
        } catch(err) {
            this.onError(err)
        }
    }

    onWebSocketSend(con, message) {
        try {
            this._execEventCallbacks('send', con, message)
        } catch(err) {
            this.onError(err)
        }
    }

    onWebSocketClose(con) {
        try {
            this._execEventCallbacks('close', con)
        } catch(err) {
            this.onError(err)
        }

        this.freeConnection(con)
    }

    onWebSocketError(con, err) {
        try {
            this._execEventCallbacks('connectionError', con, err)
        } catch(err) {
            this.onError(err)
        }
    }
}
