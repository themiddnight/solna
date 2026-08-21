import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { prisma } from '@/config/prisma';

interface TestUser { id: string; email: string; username: string; passwordHash: string; userType: string }

// Mock auth BEFORE importing the router (donor pattern)
jest.mock('../../domains/auth/infrastructure/middleware/authMiddleware', () => ({
  authenticateToken: jest.fn((req: { user?: TestUser }, _res: unknown, next: () => void) => { next(); }),
  optionalAuthAllowGuest: jest.fn((req: { user?: TestUser }, _res: unknown, next: () => void) => { next(); }),
}));
import { authenticateToken } from '../../domains/auth/infrastructure/middleware/authMiddleware';
import bandsRouter from '../bands';

describe('bands routes (HTTP)', () => {
  let app: Express;
  let owner: TestUser;
  let joiner: TestUser;
  // Band model has no ownerId column (ownership = BandMember role OWNER) — track ids to clean up by id.
  const createdBandIds: string[] = [];

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/bands', bandsRouter);
    owner = await prisma.user.create({ data: { email: `bo-${Date.now()}@e.com`, username: `bo-${Date.now()}`.slice(0, 30), passwordHash: 'x', userType: 'REGISTERED' } }) as unknown as TestUser;
    joiner = await prisma.user.create({ data: { email: `bj-${Date.now()}@e.com`, username: `bj-${Date.now()}`.slice(0, 30), passwordHash: 'x', userType: 'REGISTERED' } }) as unknown as TestUser;
  });

  afterAll(async () => {
    await prisma.bandMember.deleteMany({ where: { userId: { in: [owner.id, joiner.id] } } });
    await prisma.band.deleteMany({ where: { id: { in: createdBandIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, joiner.id] } } });
  });

  const asUser = (u: TestUser) => (authenticateToken as jest.Mock).mockImplementation(
    (req: { user?: TestUser }, _res: unknown, next: () => void) => { req.user = u; next(); });

  it('POST / creates a band (201) owned by the caller', async () => {
    asUser(owner);
    const res = await request(app).post('/api/bands').send({ name: 'The Testers' });
    expect(res.status).toBe(201);
    const body = res.body as { band: { id: string; name: string; inviteToken?: string } };
    expect(body.band.id).toBeTruthy();
    expect(body.band.name).toBe('The Testers');
    expect(body.band.inviteToken).toBeTruthy();
    createdBandIds.push(body.band.id);
  });

  it('POST / rejects an empty name (400)', async () => {
    asUser(owner);
    const res = await request(app).post('/api/bands').send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('POST /join/:token joins the band, then GET / lists it for the member', async () => {
    asUser(owner);
    const created = await request(app).post('/api/bands').send({ name: 'Join Target' });
    const createdBand = (created.body as { band: { id: string; inviteToken: string } }).band;
    createdBandIds.push(createdBand.id);
    const token = createdBand.inviteToken;

    asUser(joiner);
    const joinRes = await request(app).post(`/api/bands/join/${token}`);
    expect(joinRes.status).toBe(200);

    const list = await request(app).get('/api/bands');
    expect(list.status).toBe(200);
    const listBody = list.body as { bands: Array<{ id: string }> };
    expect(listBody.bands.some((b) => b.id === createdBand.id)).toBe(true);
  });

  it('POST /join/:token returns 404 for an unknown token', async () => {
    asUser(joiner);
    const res = await request(app).post('/api/bands/join/not-a-real-token');
    expect(res.status).toBe(404);
  });
});
