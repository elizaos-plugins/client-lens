import { LensAgentClient } from './lens-agent-client';

const LensClientInterface = {
    name: 'lens',
    config: {},
    start: async (runtime: any) => new LensAgentClient(runtime) as any,
    stop: async (runtime: any) => {
        try {
            // stop it
            console.log("Stopping lens client", runtime.agentId);
            await runtime.clients.lens.stop();
        } catch (e) {
            console.error("client-lens interface stop error", e);
        }
    },
};
export default LensClientInterface;