const { subscriber, serialized, coreConnected, applyConfigTopic } = require('./node_util');
module.exports = function(RED) {
    function nibePrice(config) {
        RED.nodes.createNode(this,config);
        const server = RED.nodes.getNode(config.server);
        // Subscriptions to the shared emitter: released on close, and a handler
        // exception is reported on this node instead of propagating into the
        // config node's emit() (see node_util.js).
        const sub = subscriber(this, server);
        const startUp = () => {
            let system = config.system.replace('s','S');
            let conf = server.nibe.getConfig();
            this.status({ fill: 'yellow', shape: 'dot', text: `System ${system}` });
            let arr = [
                {topic:"inside_set_"+config.system,source:"nibe"},
                {topic:"outside",source:"nibe"}
            ];
            const pump = conf.system!==undefined ? conf.system.pump : undefined;
            if(pump!=="F370" && pump!=="F470") {
                arr.push({topic:"dM",source:"nibe"});
                arr.push({topic:"dMstart",source:"nibe"})
            }
            
            if(conf.price===undefined) {
                conf.price = {};
                server.nibe.setConfig(conf);
            }
            if(conf.home===undefined) conf.home = {};
            if(conf.home.inside_sensors===undefined) {
                conf.home.inside_sensors = [];
                server.nibe.setConfig(conf);
            }
            
            if(conf.price['sensor_'+config.system]===undefined || conf.price['sensor_'+config.system]=="Ingen") {
                arr.push({topic:"inside_"+config.system,source:"nibe"});
            } else {
                let index = conf.home.inside_sensors.findIndex(i => i.name == conf.price['sensor_'+config.system]);
                if(index!==-1) {
                    var insideSensor = Object.assign({}, conf.home.inside_sensors[index]);
                    arr.push(insideSensor);
                }
            }
            if(conf.price.enable!==true) arr = [];
                return server.initiatePlugin(arr,'price',config.system).then(data => {
                    this.status({ fill: 'green', shape: 'dot', text: `System ${system}` });
                    this.send({enabled:true});
                },(reject => {
                    this.status({ fill: 'red', shape: 'dot', text: `System ${system}` });
                    this.send({enabled:false});
                }));
        
        }
        // One startUp at a time; errors and rejections go to node.error.
        const start = serialized(this, startUp);
        this.on('input', function(msg) {
            let conf = server.nibe.getConfig();
            if(msg.topic=="update") {
                let data = {system:config.system}
                server.updateData(data);
                return;
            } else if(msg.topic=="price/enable") {
                // Only this node's own config categories are writable (see applyConfigTopic).
                const res = applyConfigTopic(conf, msg.topic, msg.payload, ['price'], '');
                if(res.error!==undefined) {
                    this.error(res.error, msg);
                    return;
                }
                if(res.changed) server.nibe.setConfig(conf);
                start();
            } else if(msg.payload!==undefined && msg.topic!==undefined && msg.topic!=="") {
                // Only this node's own config categories are writable (see applyConfigTopic).
                const res = applyConfigTopic(conf, msg.topic, msg.payload, ['price'], '_'+config.system);
                if(res.error!==undefined) {
                    this.error(res.error, msg);
                    return;
                }
                if(res.changed) server.nibe.setConfig(conf);
                start();
            }
            
        });
        // Restart on every 'ready' (reconnect, sensor list change), not only when
        // the node was created before the pump connected: after a partial
        // redeploy the plugin would otherwise never restart on a reconnect.
        sub('ready', () => start());
        if(coreConnected(server)) start();
        sub(this.id, (data) => {
            if(data.changed===true) {
                config.system = data.system;
                if(coreConnected(server)) start();
            }
        })
        sub('pluginPriceGraph', (data) => {
            if(data.system===config.system) {
                this.send({topic:"Graf",payload:[]});
                this.send({topic:"Graf",payload:data.values});
            }
        });
        // === FIX: forward pool graph as its own topic so Price 1.1 can route it ===
        sub('pluginPriceGraphPool', (data) => {
            if(data.system===config.system) {
                this.warn("POOL-GRAPH sys="+data.system+" len="+(data.values?data.values.length:0)); this.send({topic:"Graf Pool",payload:[]});
                this.send({topic:"Graf Pool",payload:data.values});
            }
        });
        sub('pluginPrice', (data) => {
            if(data.system===config.system) {
                // Any of these can be missing when the price source failed.
                const v = (r) => (r!==undefined && r!==null) ? r.data : undefined;
                if(data.price_level===undefined) {
                    if(v(data.heat_price_level)!==undefined) this.send({topic:"Nuvarande Elprisnivå",payload:v(data.heat_price_level)});
                    if(v(data.hw_price_level)!==undefined) this.send({topic:"Nuvarande Elprisnivå (VV)",payload:v(data.hw_price_level)});
                    if(v(data.price_current)!==undefined) this.send({topic:"Nuvarande Elpris",payload:v(data.price_current)});
                    this.send([null,{topic:"test",payload:data}]);
                } else {
                    if(v(data.price_level)!==undefined) this.send({topic:"Nuvarande Elprisnivå",payload:v(data.price_level)});
                    if(v(data.price_current)!==undefined) this.send({topic:"Nuvarande Elpris",payload:v(data.price_current)});
                    this.send([null,{topic:"test",payload:data}]);
                }
            }
        })

        this.on('close', function() {
            let system = config.system.replace('s','S');
            this.status({ fill: 'yellow', shape: 'dot', text: `System ${system}` });
        });
    }
    RED.nodes.registerType("nibe-price",nibePrice);
}