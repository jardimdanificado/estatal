import FMODInit from "../lib/fmodstudio.js";
const FMOD = await FMODInit();

class FMODAudioSystem {
    constructor() {
        this.system = null;
        this.banks = {};
        this.events = {};
        this.initialized = false;
    }

    async init() {
        try {
            console.log('Inicializando FMOD...');

            const outval = {};
            const result = FMOD.Studio_System_Create(outval);

            if (result !== FMOD.OK) {
                throw new Error(`Studio_System_Create failed with code: ${result}`);
            }

            this.system = outval.val;

            const initResult = this.system.initialize(512, FMOD.STUDIO_INIT_NORMAL, FMOD.INIT_NORMAL, null);

            if (initResult !== FMOD.OK) {
                throw new Error(`Initialize failed with code: ${initResult}`);
            }

            this.initialized = true;
            console.log('FMOD System initialized successfully');
            return true;
        } catch (error) {
            console.error('Failed to initialize FMOD:', error);
            return false;
        }
    }

    async loadBank(bankPath, loadSamples = true) {
        if (!this.initialized) {
            console.error('FMOD not initialized');
            return false;
        }

        try {
            console.log(`Carregando banco: ${bankPath}`);

            const response = await fetch(bankPath);
            if (!response.ok) {
                throw new Error(`Failed to fetch bank file: ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const bankData = new Uint8Array(arrayBuffer);

            const outval = {};
            const result = this.system.loadBankMemory(
                bankData,
                bankData.length,
                FMOD.STUDIO_LOAD_MEMORY,
                FMOD.STUDIO_LOAD_BANK_NORMAL,
                outval
            );

            if (result !== FMOD.OK) {
                throw new Error(`loadBankMemory failed with code: ${result}`);
            }

            const bank = outval.val;

            if (loadSamples) {
                const sampleResult = bank.loadSampleData();
                if (sampleResult !== FMOD.OK) {
                    console.warn(`Load sample data warning: ${sampleResult}`);
                }
            }

            this.banks[bankPath] = bank;
            console.log(`Bank loaded: ${bankPath}`);
            return true;
        } catch (error) {
            console.error(`Failed to load bank ${bankPath}:`, error);
            return false;
        }
    }

    async playEvent(eventPath, params = {}, { autoStart = true } = {}) {
        if (!this.initialized) {
            console.error('FMOD not initialized');
            return null;
        }

        try {
            const outval = {};
            const descResult = this.system.getEvent(eventPath, outval);

            if (descResult !== FMOD.OK) {
                throw new Error(`getEvent failed with code: ${descResult}`);
            }

            const eventDescription = outval.val;

            const instOutval = {};
            const instResult = eventDescription.createInstance(instOutval);

            if (instResult !== FMOD.OK) {
                throw new Error(`createInstance failed with code: ${instResult}`);
            }

            const eventInstance = instOutval.val;

            for (const [paramName, value] of Object.entries(params)) {
                eventInstance.setParameterByName(paramName, value, false);
            }

            const eventId = `${eventPath}_${Date.now()}`;
            this.events[eventId] = eventInstance;

            console.log(`♪ Playing event: ${eventPath}`);
            if (autoStart) {
                const startResult = eventInstance.start();
                if (startResult !== FMOD.OK) throw new Error(`start failed: ${startResult}`);
            }

            return eventInstance;
        } catch (error) {
            console.error(`Failed to play event ${eventPath}:`, error);
            return null;
        }
    }

    async playOneShot(eventPath, position = null) {
        const instance = await this.playEvent(eventPath, {}, { autoStart: false });

        if (instance && position) {
            const attributes = {
                position: { x: position.x, y: position.y, z: position.z },
                velocity: { x: 0, y: 0, z: 0 },
                forward: { x: 0, y: 0, z: 1 },
                up: { x: 0, y: 1, z: 0 }
            };

            const r3d = instance.set3DAttributes(attributes);
            if (r3d !== FMOD.OK) console.warn("set3DAttributes:", r3d);
        }

        if (!instance) return null;

        const rs = instance.start();
        if (rs !== FMOD.OK) console.warn("start:", rs);

        instance.release();
        return instance;
    }

    async stopEvent(eventInstance, allowFadeout = true) {
        if (eventInstance) {
            const mode = allowFadeout ? FMOD.STUDIO_STOP_ALLOWFADEOUT : FMOD.STUDIO_STOP_IMMEDIATE;
            eventInstance.stop(mode);
        }
    }

    setListenerPosition(position, forward, up) {
        if (!this.initialized) return;

        const attributes = {
            position: { x: position.x, y: position.y, z: position.z },
            velocity: { x: 0, y: 0, z: 0 },
            forward: { x: forward.x, y: forward.y, z: forward.z },
            up: { x: up.x, y: up.y, z: up.z }
        };

        const r = this.system.setListenerAttributes(0, attributes, null);
        if (r !== FMOD.OK) console.warn("setListenerAttributes:", r);
    }



    update() {
        if (this.initialized && this.system) {
            this.system.update();
        }
    }

    async cleanup() {
        for (const eventId in this.events) {
            await this.stopEvent(this.events[eventId], false);
        }
        this.events = {};

        for (const bankPath in this.banks) {
            this.banks[bankPath].unload();
        }
        this.banks = {};

        if (this.system) {
            this.system.release();
        }

        this.initialized = false;
        console.log('FMOD cleaned up');
    }
}

export const audioSystem = new FMODAudioSystem();
export default audioSystem;
