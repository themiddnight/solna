declare global {
    var testUtils: {
        wait: (ms: number) => Promise<void>;
        createMockUser: (id?: string) => any;
        createMockRoom: (id?: string) => any;
    };
}
export {};
//# sourceMappingURL=setup.d.ts.map