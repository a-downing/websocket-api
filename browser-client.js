// test12
export default class WebSocketApiClient {
    constructor() {
        this.requests = new Map()
        this.freeRequestIds = new Set()
        this.requestMethods = new Map()
        this.eventCallbacks = new Map()
        this.eventCallbackSymbols = new Map()
        this.connected = false
        this.connectPromise = {pending: false}
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

    connect(address, protocols) {
        let promise = new Promise((resolve, reject) => {
            this.connectPromise = {
                pending: true,
                resolve: resolve,
                reject: reject
            }
        })

        this.connection = new WebSocket(address, protocols)

        this.connection.onopen = () => {
            this.connected = true
            this.connectPromise.resolve(this)
            this.connectPromise.pending = false

            try {
                this._execEventCallbacks('open')
            } catch(err) {
                this.onError(err)
            }
        }

        this.connection.onclose = (event) => {
            this.connected = false

            if(this.connectPromise.pending) {
                this.connectPromise.reject(event)
            }

            for(let request of this.requests.values()) {
                request.reject(event)
            }

            try {
                this._execEventCallbacks('close', event)
            } catch(err) {
                this.onError(err)
            }
        }

        this.connection.onerror = (event) => {
            this.onError(event)
        }

        this.connection.onmessage = (message) => {
            try {
                let msg = JSON.parse(message.data)

                if(!msg.hasOwnProperty('type')) {
                    throw new Error('missing message type')
                } else {
                    if(Object.prototype.toString.call(msg.type) != '[object String]') {
                        throw new Error('invalid message type')
                    } else if(msg.type == 'request' || msg.type == 'response') {
                        if(!msg.hasOwnProperty('id')) {
                            throw new Error('missing message id')
                        } else {
                            if(Object.prototype.toString.call(msg.id) != '[object Number]' || !Number.isInteger(msg.id)) {
                                throw new Error('invalid message id')
                            }
                        }
                    }
                }

                if(!msg.hasOwnProperty('name')) {
                    throw new Error('missing message name')
                } else {
                    if(Object.prototype.toString.call(msg.type) != '[object String]') {
                        throw new Error('invalid message name')
                    }
                }

                this.onMessage(msg)
                this._execEventCallbacks('message', message)
            } catch(err) {
                this.onError(err)
            }
        }

        return promise
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
        this.connected = false
        this.connection.close()
    }

    sendRequest(name, data) {
        return new Promise((resolve, reject) => {
            if(!this.connected) {
                reject(new Error('WebSocket Not connected (this.connected == false)'))
            }

            let requestId = this._getFreeRequestId()

            let message = JSON.stringify({
                type: 'request',
                name: name,
                id: requestId,
                data: data
            })

            try {
                this._execEventCallbacks('send', message)
            } catch(err) {
                this.onError(err)
            }

            this.requests.set(requestId, {
                resolve: resolve,
                reject: reject
            })

            try {
                if(this.connection.readyState != 1) {
                    throw new Error('WebSocket Not connected (this.connection.readyState != 1)')
                }

                this.connection.send(message)
            } catch(err) {
                this.requests.delete(requestId)
                reject(err)
            }
        })
    }

    _sendResponse(name, id, status, data) {
        try {
            if(!this.connected) {
                throw new Error('WebSocket Not connected (this.connected == false)')
            }

            let message = JSON.stringify({
                type: 'response',
                name: name,
                id: id,
                status: status,
                data: data
            })

            if(this.connection.readyState != 1) {
                throw new Error('WebSocket Not connected (this.connection.readyState != 1)')
            }

            this.connection.send(message)
            this._execEventCallbacks('send', message)
        } catch(err) {
            this.onError(err)
        }
    }

    registerRequest(name, method) {
        this.requestMethods.set(name, method)
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
            if(!this.requestMethods.has(msg.name)) {
                this.onError(new Error('request method does not exist'))
            } else {
                this.requestMethods.get(msg.name)(msg.data).then((result) => {
                    this._sendResponse(msg.name, msg.id, 'resolve', result)
                }).catch((err) => {
                    this._sendResponse(msg.name, msg.id, 'reject', err.toString())
                })
            }
        }
    }
}
