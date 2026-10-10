
const { subscriber, serialized, coreConnected, applyConfigTopic } = require('./node_util');
module.exports = function(RED) {
     function nibeHotwater(config) {
        RED.nodes.createNode(this,config);
        const server = RED.nodes.getNode(config.server);
        // Subscriptions to the shared emitter: released on close, and a handler
        // exception is reported on this node instead of propagating into the
        // config node's emit() (see node_util.js).
        const sub = subscriber(this, server);
        const startUp = () => {
            const arr = [
                //{topic:"bt6",source:"nibe"},
                //{topic:"bt7",source:"nibe"},
            ];
            let conf = server.nibe.getConfig();
            if(conf.price===undefined) {
                conf.price = {};
                server.nibe.setConfig(conf);
            }
            return server.initiatePlugin(arr,'hotwater').then(result => {
            this.status({ fill: 'green', shape: 'dot', text: `` });
            this.send({enabled:true});
        },(reject => {
            this.status({ fill: 'red', shape: 'dot', text: `` });
            this.send({enabled:false});
        }));
        }
        // One startUp at a time; errors and rejections go to node.error.
        const start = serialized(this, startUp);
        
        // Restart on every 'ready' (reconnect, sensor list change), not only when
        // the node was created before the pump connected: after a partial
        // redeploy the plugin would otherwise never restart on a reconnect.
        sub('ready', () => start());
        if(coreConnected(server)) start();
        this.on('input', function(msg) {
            let conf = server.nibe.getConfig();
            if(msg.topic=="update") {
                server.hotwaterPlugin();
                return;
            }
            if(msg.payload!==undefined && msg.topic!==undefined && msg.topic!=="") {
                // nibe-hotwater has no system setting; the old code wrote keys ending
                // in '_undefined'. config_node reads e.g. hotwater.enable_autoluxury.
                // Only this node's own config categories are writable (see applyConfigTopic).
                const res = applyConfigTopic(conf, msg.topic, msg.payload, ['hotwater'], config.system!==undefined ? '_'+config.system : '');
                if(res.error!==undefined) {
                    this.error(res.error, msg);
                    return;
                }
                if(res.changed) {
                    server.nibe.setConfig(conf);
                    start();
                }
            }
            
        });
        sub(this.id, (data) => {
            if(data.changed===true) {
                if(coreConnected(server)) start();
            }
        })
        // A core fault means the pump link is down: show it until the next
        // 'ready' restarts the plugin (startUp sets the status again).
        sub('fault', (data) => {
            if(data===undefined || data===null || data.from!=="core") return;
            this.status({ fill: 'red', shape: 'ring', text: `Core fault` });
        });
        sub('pluginHotwaterAutoLuxury', (value) => {
            if(value.bt7!==undefined && value.bt7.data>-3276) {
                const bt6 = value.bt6!==undefined ? value.bt6.data : undefined;
                this.send({topic:"BT7 Topp",payload:value.bt7.data})
                if(bt6!==undefined) this.send({topic:"BT6 Laddning",payload:bt6})
                if(value.hwTriggerTemp!==undefined) this.send({topic:"Startvärde",payload:value.hwTriggerTemp})
                if(value.hwTargetValue!==undefined) {
                    this.send({topic:"Stoppvärde",payload:value.hwTargetValue});
                } else if(bt6!==undefined) {
                    this.send({topic:"Stoppvärde",payload:bt6});
                }
            }
    })
        sub('pluginHotwaterPriority', (value) => {
                if(value.bt7!==undefined && value.bt7.data>-3276) {
                    this.send([null,{topic:"BT7 Topp",payload:value.bt7.data}])
                    if(value.bt6!==undefined) this.send([null,{topic:"BT6 Laddning",payload:value.bt6.data}])
                    if(value.hwStartTemp!==undefined) this.send([null,{topic:"Startvärde",payload:value.hwStartTemp.data}])
                    if(value.hwStopTemp!==undefined) this.send([null,{topic:"Stoppvärde",payload:value.hwStopTemp.data}])
                    
                }
        })
        this.on('close', function() {
            this.status({ fill: 'yellow', shape: 'dot', text: `` });
        });
    }
    RED.nodes.registerType("nibe-hotwater",nibeHotwater);
}
