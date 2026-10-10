
const { subscriber, hhmm } = require('./node_util');
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
        // Status freshness. A data node's status used to stay green forever
        // after its last update, even with the pump link down.
        const STALE_MIN = 10*60*1000;
        let state = 'ok';       // 'ok', 'stale' or 'fault'
        let lastUpdate;         // time of the last update
        let interval;           // time between the last two updates (~poll interval)
        let lastText;
        let staleTimer;
        const fresh = (text) => {
            const now = Date.now();
            if(lastUpdate!==undefined) interval = now-lastUpdate;
            lastUpdate = now;
            if(text!==undefined) lastText = text;
            if(text!==undefined || (state!=='ok' && lastText!==undefined)) {
                node.status({ fill: 'green', shape: 'dot', text: lastText });
            }
            state = 'ok';
            clearTimeout(staleTimer);
            // Stale after 3x the observed update interval, 10 min at least.
            const limit = Math.max(STALE_MIN, interval!==undefined ? 3*interval : 0);
            staleTimer = setTimeout(() => {
                if(state==='fault') return;
                state = 'stale';
                node.status({ fill: 'grey', shape: 'ring', text: `Stale since ${hhmm(lastUpdate)}` });
            }, limit);
        };
        const watchCore = () => {
            sub('fault', data => {
                if(data===undefined || data===null || data.from!=="core") return;
                state = 'fault';
                node.status({ fill: 'red', shape: 'ring', text: `Core fault` });
            });
        };
        node.on('close', function() {
            clearTimeout(staleTimer);
        });
        if(config.name=="") {
            watchCore();
            sub('data', data => {
                let saved = node.context().get(data.register);
                if(data.error!==undefined) {
                    
                } else {
                    if(saved!=data.data) {
                        node.send([{topic:data.register,payload:data.data},{topic:data.register,payload:data.data,raw:data}]);
                        node.context().set(data.register, data.data);
                        fresh(`${data.register}: ${data.data} ${data.unit}`);
                    } else {
                        node.send([null,{topic:data.register,payload:data.data,raw:data}]);
                        fresh();
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
        watchCore();
        sub(register, data => {
            if(register===data.register) {
                let saved = node.context().get(data.register);
                if(data.error!==undefined) {
                    
                } else {
                    if(saved!=data.data) {
                        node.send([{topic:data.register,payload:data.data,raw:data},{topic:data.register,payload:data.data,raw:data}]);
                        node.context().set(data.register, data.data);
                        fresh(`${data.data}${data.unit}`);
                    } else {
                        node.send([null,{topic:data.register,payload:data.data,raw:data}]);
                        fresh();
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