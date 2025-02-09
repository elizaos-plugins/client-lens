import { LensAgentClient } from "./lens-client";

const lensPlugin = {
    name: "lens",
    description: "Lens client plugin",
    clients: [LensAgentClient],
};
export default lensPlugin;
