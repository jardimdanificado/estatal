export function ensureEventStore(target) {
    if (!target.events) target.events = {};
    if (!target.eventSources) target.eventSources = {};
}

export function addEventHandler(target, eventName, handler, source = null) {
    if (typeof handler !== 'function') return;
    ensureEventStore(target);
    if (!target.events[eventName]) target.events[eventName] = [];
    target.events[eventName].push(handler);
    if (source) {
        if (!target.eventSources[eventName]) target.eventSources[eventName] = [];
        target.eventSources[eventName].push(source);
    }
}

export function hasEventHandlers(target, eventName) {
    return !!(target.events && target.events[eventName] && target.events[eventName].length);
}

export function runEventHandlers(target, eventName, ...args) {
    const handlers = target.events && target.events[eventName];
    if (!handlers || !handlers.length) return false;
    let ran = false;
    for (const handler of handlers) {
        try {
            handler(...args);
            ran = true;
        } catch (err) {
            console.warn(`Erro em evento ${eventName}:`, err);
        }
    }
    return ran;
}
