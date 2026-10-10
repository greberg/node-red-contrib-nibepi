
const { subscriber } = require('./node_util');
module.exports = function(RED) {
    function nibeInput(config) {
        RED.nodes.createNode(this,config);
        const server = RED.nodes.getNode(config.server);
        // Subscriptions to the shared emitter: released on close, and a handler
        // exception is reported on this node instead of propagating into the
        // config node's emit() (see node_util.js).
        const sub = subscriber(this, server);
        const nibe = server.nibe;
        var savedError = {};
        if(config.add===true && config.name.toLowerCase()!="config" && config.name.toLowerCase()!="error") {
            nibe.addRegister(config.name);
        }
        let register = config.name.toLowerCase();
        if(server.hP()[config.name]!==undefined) {
            register = server.hP()[config.name]
        }
        sub('ready', data => {
            if(server.hP()[config.name]!==undefined) {
                register = server.hP()[config.name]
            }
        })
        var node = this;
        if(config.name=="") {
            sub('data', data => {
                let saved = node.context().get(data.register);
                if(data.error!==undefined) {
                    
                } else {
                    if(saved!=data.data) {
                        node.send([{topic:data.register,payload:data.data},{topic:data.register,payload:data.data,raw:data}]);
                        node.context().set(data.register, data.data);
                        node.status({ fill: 'green', shape: 'dot', text: `${data.register}: ${data.data} ${data.unit}` });
                    } else {
                        node.send([null,{topic:data.register,payload:data.data,raw:data}]);
                    }
                }
        })
    } else if(config.name.toLowerCase()=="error") {
        sub('fault', data => {
            if(savedError.from!==data.from || savedError.message!==data.message) {
                node.send({topic:data.from,payload:data.message});
                savedError = data;
            }
            node.send([null,{topic:data.from,payload:data.message}]);
        })
    } else if(config.name.toLowerCase()!=="config") {
        // A node named "config" would otherwise subscribe to the 'config' event
        // twice: once here, because register === "config", and again below. This
        // first subscription is dead anyway - its handler opens with
        // if(register===data.register), and a config payload carries no .register,
        // so it never fires. With ~425 such nodes across the subflow instances, the
        // duplicate alone doubled the listener count past EventEmitter's ceiling.
        sub(register, data => {
            if(register===data.register) {
                let saved = node.context().get(data.register);
                if(data.error!==undefined) {
                    
                } else {
                    if(saved!=data.data) {
                        node.send([{topic:data.register,payload:data.data,raw:data},{topic:data.register,payload:data.data,raw:data}]);
                        node.context().set(data.register, data.data);
                        node.status({ fill: 'green', shape: 'dot', text: `${data.data}${data.unit}` });
                    } else {
                        node.send([null,{topic:data.register,payload:data.data,raw:data}]);
                    }
                }

            }
        })
    }
        /*nibe.data.on(register, data => {
                node.status({ fill: 'red', shape: 'dot', text: data });
        })*/
    if(config.name.toLowerCase()=="config") {
        sub('config', data => {
            node.send([{topic:"config",payload:data},null]);
        })
        server.nibe.getConfig();
    }
    }
    RED.nodes.registerType("nibe-input",nibeInput);
}