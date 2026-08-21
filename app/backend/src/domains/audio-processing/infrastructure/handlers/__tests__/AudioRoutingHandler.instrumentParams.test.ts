/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AudioRoutingHandler } from '../AudioRoutingHandler';

/**
 * DEV-317: late-joiner instrument-params propagation.
 *
 * Proves that sendInstrumentParamsToNewUser reads persisted instrumentParams
 * from room state and emits them directly to the joiner — without requiring
 * any live knob change from the source peer.
 */

describe('AudioRoutingHandler — sendInstrumentParamsToNewUser (DEV-317)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handler: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRoomLifecycleService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRoomSessionManager: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockIo: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockNamespaceManager: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getRoomMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getRoomSessionMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let joinerSocket: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let otherSocket: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let namespace: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeBandMember(overrides: Record<string, any> = {}): Record<string, any> {
    return {
      id: 'member-1',
      username: 'TestUser',
      currentInstrument: 'acoustic_grand_piano',
      currentCategory: 'drums',
      isPlaying: false,
      isMuted: false,
      effectChains: {},
      ...overrides,
    };
  }

  function buildSockets(joinerId: string): Map<string, Record<string, unknown>> {
    joinerSocket = { id: joinerId, emit: jest.fn() };
    otherSocket = { id: 'other-socket', emit: jest.fn() };
    return new Map([
      [joinerId, joinerSocket],
      ['other-socket', otherSocket],
    ]);
  }

  function buildNamespace(sockets: Map<string, Record<string, unknown>>) {
    return { sockets, name: '/room/test-room', emit: jest.fn() };
  }

  beforeEach(() => {
    getRoomMock = jest.fn();
    getRoomSessionMock = jest.fn();

    mockRoomLifecycleService = { getRoom: getRoomMock };
    mockRoomSessionManager = { getRoomSession: getRoomSessionMock };

    mockIo = {};
    mockNamespaceManager = {};

    handler = new AudioRoutingHandler(
      mockRoomLifecycleService,
      mockIo,
      mockRoomSessionManager,
      mockNamespaceManager,
    );
  });

  it('emits persisted instrumentParams to the joiner without requiring a live change', async () => {
    // Arrange: 2 existing non-synth members with instrumentParams
    const memberA = makeBandMember({
      id: 'user-A',
      username: 'Alice',
      currentInstrument: 'tr808_kit',
      currentCategory: 'drums',
      instrumentParams: { volume: -9.5 },
    });
    const memberB = makeBandMember({
      id: 'user-B',
      username: 'Bob',
      currentInstrument: 'rhodes_mark_i',
      currentCategory: 'sampler',
      instrumentParams: { volume: -3 },
    });

    getRoomMock.mockResolvedValue({
      bandMembers: new Map([
        ['user-A', memberA],
        ['user-B', memberB],
        ['new-user', makeBandMember({ id: 'new-user', username: 'NewGuy' })],
      ]),
      audiences: new Map(),
    });

    const sockets = buildSockets('joiner-socket');
    namespace = buildNamespace(sockets);

    getRoomSessionMock.mockImplementation((socketId: string) => {
      if (socketId === 'joiner-socket') return { userId: 'new-user' };
      return null;
    });

    // Act
    await handler.sendInstrumentParamsToNewUser(namespace, 'test-room', 'new-user');

    // Assert: joiner receives two payloads, one per existing member
    expect(joinerSocket.emit).toHaveBeenCalledTimes(2);
    expect(joinerSocket.emit).toHaveBeenNthCalledWith(
      1,
      'perform:send_instrument_params_to_new_user',
      {
        userId: 'user-A',
        username: 'Alice',
        instrument: 'tr808_kit',
        category: 'drums',
        params: { volume: -9.5 },
      },
    );
    expect(joinerSocket.emit).toHaveBeenNthCalledWith(
      2,
      'perform:send_instrument_params_to_new_user',
      {
        userId: 'user-B',
        username: 'Bob',
        instrument: 'rhodes_mark_i',
        category: 'sampler',
        params: { volume: -3 },
      },
    );

    // Other socket was NOT emitted to
    expect(otherSocket.emit).not.toHaveBeenCalled();
  });

  it('skips members without instrumentParams', async () => {
    const memberWithParams = makeBandMember({
      id: 'user-A',
      username: 'Alice',
      currentInstrument: 'tr808_kit',
      currentCategory: 'drums',
      instrumentParams: { volume: -6 },
    });
    // member-B intentionally has NO instrumentParams field
    const memberWithoutParams = makeBandMember({
      id: 'user-B',
      username: 'Bob',
      currentInstrument: 'rhodes_mark_i',
      currentCategory: 'sampler',
    });
    delete memberWithoutParams.instrumentParams;

    getRoomMock.mockResolvedValue({
      bandMembers: new Map([
        ['user-A', memberWithParams],
        ['user-B', memberWithoutParams],
        ['new-user', makeBandMember({ id: 'new-user', username: 'NewGuy' })],
      ]),
      audiences: new Map(),
    });

    const sockets = buildSockets('joiner');
    namespace = buildNamespace(sockets);

    getRoomSessionMock.mockReturnValue({ userId: 'new-user' });

    await handler.sendInstrumentParamsToNewUser(namespace, 'test-room', 'new-user');

    expect(joinerSocket.emit).toHaveBeenCalledTimes(1);
    expect(joinerSocket.emit).toHaveBeenCalledWith(
      'perform:send_instrument_params_to_new_user',
      expect.objectContaining({ userId: 'user-A' }),
    );
  });

  it('excludes the joiner from the results', async () => {
    const joinerMember = makeBandMember({
      id: 'new-user',
      username: 'NewGuy',
      currentInstrument: 'tr808_kit',
      currentCategory: 'drums',
      instrumentParams: { volume: -12 },
    });
    const otherMember = makeBandMember({
      id: 'user-A',
      username: 'Alice',
      currentInstrument: 'rhodes_mark_i',
      currentCategory: 'sampler',
      instrumentParams: { volume: -3 },
    });

    getRoomMock.mockResolvedValue({
      bandMembers: new Map([
        ['new-user', joinerMember],
        ['user-A', otherMember],
      ]),
      audiences: new Map(),
    });

    const sockets = buildSockets('joiner');
    namespace = buildNamespace(sockets);

    getRoomSessionMock.mockReturnValue({ userId: 'new-user' });

    await handler.sendInstrumentParamsToNewUser(namespace, 'test-room', 'new-user');

    expect(joinerSocket.emit).toHaveBeenCalledTimes(1);
    expect(joinerSocket.emit).toHaveBeenCalledWith(
      'perform:send_instrument_params_to_new_user',
      expect.objectContaining({ userId: 'user-A' }),
    );
  });

  it('excludes synthesizer members (synth handled separately)', async () => {
    const synthMember = makeBandMember({
      id: 'user-A',
      username: 'Alice',
      currentInstrument: 'analogue_synth',
      currentCategory: 'synthesizer',
      instrumentParams: { volume: -6 },
    });
    const drumMember = makeBandMember({
      id: 'user-B',
      username: 'Bob',
      currentInstrument: 'tr808_kit',
      currentCategory: 'drums',
      instrumentParams: { volume: -3 },
    });

    getRoomMock.mockResolvedValue({
      bandMembers: new Map([
        ['user-A', synthMember],
        ['user-B', drumMember],
        ['new-user', makeBandMember({ id: 'new-user', username: 'NewGuy' })],
      ]),
      audiences: new Map(),
    });

    const sockets = buildSockets('joiner');
    namespace = buildNamespace(sockets);

    getRoomSessionMock.mockReturnValue({ userId: 'new-user' });

    await handler.sendInstrumentParamsToNewUser(namespace, 'test-room', 'new-user');

    expect(joinerSocket.emit).toHaveBeenCalledTimes(1);
    expect(joinerSocket.emit).toHaveBeenCalledWith(
      'perform:send_instrument_params_to_new_user',
      expect.objectContaining({ userId: 'user-B' }),
    );
  });

  it('does nothing when room is not found', async () => {
    getRoomMock.mockResolvedValue(null);

    const sockets = buildSockets('joiner');
    namespace = buildNamespace(sockets);

    getRoomSessionMock.mockReturnValue({ userId: 'new-user' });

    await handler.sendInstrumentParamsToNewUser(namespace, 'test-room', 'new-user');

    expect(joinerSocket.emit).not.toHaveBeenCalled();
  });

  it('does nothing when joiner socket is not in the namespace', async () => {
    const member = makeBandMember({
      id: 'user-A',
      instrumentParams: { volume: -6 },
    });

    getRoomMock.mockResolvedValue({
      bandMembers: new Map([['user-A', member]]),
      audiences: new Map(),
    });

    // Namespace with a socket that doesn't match the joiner's userId
    const strangerSocket = { id: 'stranger', emit: jest.fn() };
    namespace = {
      sockets: new Map([['stranger', strangerSocket]]),
      name: '/room/test-room',
      emit: jest.fn(),
    };

    getRoomSessionMock.mockImplementation((socketId: string) => {
      if (socketId === 'stranger') return { userId: 'someone-else' };
      return null;
    });

    await handler.sendInstrumentParamsToNewUser(namespace, 'test-room', 'new-user');

    expect(strangerSocket.emit).not.toHaveBeenCalled();
  });
});
