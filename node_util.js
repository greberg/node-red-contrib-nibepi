// Shared helpers for the nibe-* nodes. Not a Node-RED node itself (it is not
// listed under "node-red" in package.json); the node files require it.

// How often the same event's handler error is logged. Most events fire from
// the config node's per-minute cron, so an unthrottled error floods the log.
const ERROR_THROTTLE_MS = 10*60*1000;

// Subscribe a node to the config node's shared emitter. Each handler is
// wrapped so an exception is reported on this node instead of propagating
// into emit() - which would abort the rest of the config node's control loop
// (every listener after this one, and the cron code that emitted). close()
// releases exactly this node's subscriptions.
function subscriber(node, server) {
    const subs = [];
    const sub = (ev, fn) => {
        // Throttle state per subscription.
        let lastTime;
        let suppressed = 0;
        const report = (ev, err) => {
            const now = Date.now();
            if(lastTime!==undefined && now-lastTime<ERROR_THROTTLE_MS) {
                suppressed++;
                return;
            }
            const extra = suppressed>0 ? ` (${suppressed} similar suppressed)` : '';
            lastTime = now;
            suppressed = 0;
            const text = (err && err.stack) ? err.stack : String(err);
            node.error(`Error handling '${ev}': ${text}${extra}`);
        };
        const wrapped = function() {
            try {
                const result = fn.apply(this, arguments);
                if(result && typeof result.catch==='function') result.catch(err => report(ev, err));
                return result;
            } catch (err) {
                report(ev, err);
            }
        };
        subs.push([ev, wrapped]);
        server.nibeData.on(ev, wrapped);
        return wrapped;
    };
    node.on('close', function() {
        for (const s of subs) server.nibeData.removeListener(s[0], s[1]);
        subs.length = 0;
    });
    return sub;
}

// Run a plugin's startUp() at most once at a time. Calls made while one is
// running (or queued in the same tick) collapse into a single re-run after it,
// so 'ready', 'rmu_ready' and a config change arriving together don't start
// the plugin several times. fn may return a promise; a rejection or throw is
// reported with node.error. A run that never settles is given up after
// timeoutMs so later triggers aren't blocked forever.
function serialized(node, fn, timeoutMs=60000) {
    let running = false;
    let again = false;
    let closed = false;
    let run = 0;
    let timer;
    const finish = (id) => {
        if(id!==run || !running) return;
        clearTimeout(timer);
        running = false;
        if(again && !closed) {
            again = false;
            trigger();
        }
    };
    const trigger = () => {
        if(closed) return;
        if(running) {
            again = true;
            return;
        }
        running = true;
        const id = ++run;
        timer = setTimeout(() => finish(id), timeoutMs);
        // Deferred one tick so synchronous double calls coalesce.
        setImmediate(() => {
            if(closed) return finish(id);
            let p;
            try {
                p = Promise.resolve(fn());
            } catch (err) {
                p = Promise.reject(err);
            }
            p.catch(err => node.error(err)).then(() => finish(id));
        });
    };
    node.on('close', function() {
        closed = true;
        clearTimeout(timer);
    });
    return trigger;
}

function coreConnected(server) {
    return server.nibe.core!==undefined && server.nibe.core.connected===true;
}

const FORBIDDEN_KEYS = ['__proto__','constructor','prototype'];

// Apply a "category/key" message to the plugin config. Only the categories
// the node owns are writable, so a stray topic can't overwrite e.g.
// system/pump, and prototype keys are rejected. payload null removes the key.
// Returns {changed} on success or {error} with a reason.
function applyConfigTopic(conf, topic, payload, allowed, suffix='') {
    if(typeof topic!=='string') return {error:'msg.topic must be a string'};
    const req = topic.split('/');
    if(req.length!==2 || req[0]==='' || req[1]==='') return {error:`Invalid topic '${topic}', expected category/key`};
    if(FORBIDDEN_KEYS.includes(req[0]) || FORBIDDEN_KEYS.includes(req[1])) return {error:`Invalid topic '${topic}'`};
    if(!allowed.includes(req[0])) return {error:`Topic '${topic}' not allowed here, category must be one of: ${allowed.join(', ')}`};
    if(conf[req[0]]===undefined || conf[req[0]]===null || typeof conf[req[0]]!=='object') conf[req[0]] = {};
    const cat = conf[req[0]];
    const key = req[1]+suffix;
    if(payload===null) {
        if(!Object.prototype.hasOwnProperty.call(cat, key)) return {changed:false};
        delete cat[key];
        return {changed:true};
    }
    if(cat[key]===payload) return {changed:false};
    cat[key] = payload;
    return {changed:true};
}

// Parse a value for nibe.setData. Accepts numbers, numeric strings (with a
// decimal comma too) and booleans; anything else returns undefined.
function parseRegisterValue(payload) {
    if(typeof payload==='boolean') return payload ? 1 : 0;
    if(typeof payload==='number') return Number.isFinite(payload) ? payload : undefined;
    if(typeof payload!=='string') return undefined;
    const s = payload.trim().replace(',','.');
    if(s==='') return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
}

function hhmm(time) {
    const d = new Date(time);
    return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}

module.exports = {subscriber, serialized, coreConnected, applyConfigTopic, parseRegisterValue, hhmm};
