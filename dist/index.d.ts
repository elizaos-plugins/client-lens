declare const LensClientInterface: {
    name: string;
    config: {};
    start: (runtime: any) => Promise<any>;
    stop: (runtime: any) => Promise<void>;
};

export { LensClientInterface as default };
