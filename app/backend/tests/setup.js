"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
jest.setTimeout(30000);
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;
beforeAll(() => {
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
});
afterAll(() => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
});
global.testUtils = {
    wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    createMockUser: (id = 'test-user') => ({
        id,
        username: `user-${id}`,
        role: 'audience',
        isReady: true
    }),
    createMockRoom: (id = 'test-room') => ({
        id,
        name: `Room ${id}`,
        owner: 'test-owner',
        isPrivate: false,
        users: new Map(),
        createdAt: new Date()
    })
};
//# sourceMappingURL=setup.js.map