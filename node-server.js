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
            console.log(message.substring(0, 256))

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

                /*if(!_.has(msg, 'data')) {
                    throw new Error('missing message data')
                }*/

                this.onMessage(msg)
            } catch(err) {
                this.onError(err)
            }
        })
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

            this.connection.send(JSON.stringify({
                type: 'request',
                name: name,
                id: requestId,
                data: data
            }))

            this.requests.set(requestId, {
                resolve: resolve,
                reject: reject
            })
        })
    }

    _sendResponse(name, id, status, data) {
        this.connection.send(JSON.stringify({
            type: 'response',
            name: name,
            id: id,
            status: status,
            data: data
        }))
    }

    registerRequestMethod(name, method) {
        this.requestMethods.set(name, method)
    }

    getConnectionId() {
        return this.clientId
    }

    onOpen() {

    }

    onClose() {
        for(let request of this.requests.values()) {
            request.reject(new Error('WebSocket closed'))
        }

        this.webSocketApiServer.onWebSocketClose(this)
    }

    onError(err) {
        console.log('WebSocketApiServerConnection.onError ' + err)
        this.webSocketApiServer.onWebSocketError(this, err)
    }

    onMessage(msg) {
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
            this.onWebSocketConnection(webSocketConnection)

            try {
                this._execEventCallbacks('open', webSocketConnection)
            } catch(err) {
                this.onError(err)
            }
        })
    }

    onError(event) {
        try {
            this._execEventCallbacks('error', event)
        } catch(err) {

        }
    }

    on(event, callback) {
        let sym = Symbol()

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

    _execEventCallbacks(event, arg = null) {
        if(this.eventCallbacks.has(event)) {
            for(let [sym, callback] of this.eventCallbacks.get(event)) {
                callback(arg, this, sym)
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

    freeConnection(webSocketConnection) {
        let id = webSocketConnection.getConnectionId()
        this.clients.delete(id)
        this.freeClientIds.add(id)
    }

    onWebSocketConnection(webSocketConnection) {
        webSocketConnection.onOpen()
    }

    onWebSocketClose(webSocketConnection) {
        this.freeConnection(webSocketConnection)
    }

    onWebSocketError(webSocketConnection, err) {
        console.log('WebSocketApiServer.onWebSocketError ' + webSocketConnection.getConnectionId())
        webSocketConnection.close()
    }
}
