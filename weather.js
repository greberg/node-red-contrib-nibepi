
const { subscriber, serialized, coreConnected, applyConfigTopic } = require('./node_util');
module.exports = function(RED) {
     function nibeWeather(config) {
        RED.nodes.createNode(this,config);
        const server = RED.nodes.getNode(config.server);
        // Subscriptions to the shared emitter: released on close, and a handler
        // exception is reported on this node instead of propagating into the
        // config node's emit() (see node_util.js).
        const sub = subscriber(this, server);
        let system = config.system.replace('s','S');
        const startUp = () => {
            this.status({ fill: 'yellow', shape: 'dot', text: `System ${system}` });
            let conf = server.nibe.getConfig();
            if(conf.weather===undefined) {
                conf.weather = {};
                server.nibe.setConfig(conf);
            }
            let arr = [
                {topic:"outside",source:"nibe"},
                {topic:"heatcurve_"+config.system,source:"nibe"}
            ];
            if(conf.home===undefined) conf.home = {};
            if(conf.home.inside_sensors===undefined) {
                conf.home.inside_sensors = [];
                server.nibe.setConfig(conf);
            }
            
            if(conf.weather['sensor_'+config.system]===undefined || conf.weather['sensor_'+config.system]=="Ingen") {
                arr.push({topic:"inside_"+config.system,source:"nibe"});
            } else {
                let index = conf.home.inside_sensors.findIndex(i => i.name == conf.weather['sensor_'+config.system]);
                if(index!==-1) {
                    var insideSensor = Object.assign({}, conf.home.inside_sensors[index]);
                    //let insideSensor = conf.home.inside_sensors[index];
                    arr.push(insideSensor);
                }
            }
            if(conf.weather['enable_'+config.system]!==true) arr = [];
            return server.initiatePlugin(arr,'weather',config.system).then(result => {
                this.status({ fill: 'green', shape: 'dot', text: `System ${system}` });
                this.send({enabled:true});
            },(reject => {
                this.status({ fill: 'red', shape: 'dot', text: `System ${system}` });
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
                server.updateData(true);
                return;
            }
            if(msg.payload!==undefined && msg.topic!==undefined && msg.topic!=="") {
                // Only this node's own config categories are writable (see applyConfigTopic).
                const res = applyConfigTopic(conf, msg.topic, msg.payload, ['weather','home'], '_'+config.system);
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
                config.system = data.system;
                if(coreConnected(server)) start();
            }
        })
        // A core fault means the pump link is down: show it until the next
        // 'ready' restarts the plugin (startUp sets the status again).
        sub('fault', (data) => {
            if(data===undefined || data===null || data.from!=="core") return;
            this.status({ fill: 'red', shape: 'ring', text: `System ${system}: core fault` });
        });
        sub('pluginWeather', (data) => {
            if(data.system===config.system) {
                let outside = data['outside'];
                //server.nibeData.emit('forecast_1',arr,config.system);
                if(outside!==undefined) this.send({topic:"Utomhustemperatur",payload:outside.data});
                this.send({topic:"Kurvjustering",payload:data.weatherOffset});
                //if(data.predictedNow!==undefined) this.send({topic:"Nuvarande prognos",payload:data.predictedNow.payload,timestamp:data.predictedNow.timestamp});
                if(data.predictedLater!==undefined) this.send({topic:"Prognos",payload:data.predictedLater.payload,timestamp:data.predictedLater.timestamp});
                if(data.unfiltredTemp!==undefined) this.send({topic:"Ojusterad Prognos",payload:data.unfiltredTemp.payload,timestamp:data.unfiltredTemp.timestamp});
                this.send([null,{topic:"Vindgraf",payload:data.windGraph}]);
            }
        })
        this.on('close', function(removed) {
            // A deleted plugin node must stop feeding its registers to the control loop.
            if(removed===true && server && typeof server.clearList==='function') server.clearList('weather',config.system);
            this.status({ fill: 'yellow', shape: 'dot', text: `System ${system}` });
        });
    }
    RED.nodes.registerType("nibe-weather",nibeWeather);
}
