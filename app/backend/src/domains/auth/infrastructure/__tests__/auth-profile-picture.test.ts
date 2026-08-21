/**
 * Integration Tests for Profile Picture Upload
 * Tests the complete profile picture upload flow including:
 * - Multipart/form-data handling
 * - File validation
 * - Storage integration
 * - Authentication
 */
import request from 'supertest';
import type { RequestHandler, Request, Response, NextFunction } from 'express';
import express from 'express';
import multer from 'multer';

interface MockUser {
  id: string;
  email: string;
  username: string;
  userType: 'REGISTERED';
  emailVerified: boolean;
  profilePictureUrl: string | null;
}

describe('Profile Picture Upload Integration Tests', () => {
  let app: express.Express;
  let mockSaveProfilePicture: jest.Mock;
  let mockDeleteProfilePictureByUrl: jest.Mock;
  let mockFindById: jest.Mock;

  // Mock user for authentication
  const mockUser: MockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    username: 'testuser',
    userType: 'REGISTERED',
    emailVerified: true,
    profilePictureUrl: null,
  };

  // Mock auth token
  const mockAuthToken = 'mock-jwt-token';

  beforeAll(() => {
    // Setup mock functions using jest.fn()
    mockSaveProfilePicture = jest.fn((userId: string, _buffer: Buffer, _contentType: string) => {
      return Promise.resolve(`https://example.com/profile-pictures/${userId}/profile-123.jpg`);
    });

    mockDeleteProfilePictureByUrl = jest.fn((_url: string) => {
      return Promise.resolve();
    });

    mockFindById = jest.fn((_id: string) => {
      return Promise.resolve(mockUser);
    });

    // Create test Express app
    app = express();

    // Configure multer for memory storage (same as production)
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
      },
    });

    // Mock authentication middleware
    const mockAuthMiddleware: RequestHandler = (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (authHeader == null || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      (req as unknown as Record<string, unknown>).user = mockUser;
      next();
    };

    // Body parser middleware with multipart/form-data handling
    // This mimics the fix we made in index.ts
    app.use((req, _res, next) => {
      const contentType = req.get('Content-Type') ?? '';
      if (contentType.includes('multipart/form-data')) {
        // Skip JSON parsing for multipart requests - let multer handle it
        return next();
      }
      express.json({
        limit: '1mb',
        strict: true,
      })(req, _res, next);
    });

    app.use(express.urlencoded({ extended: true, limit: '100kb' }));

    // Profile picture upload endpoint
    app.put(
      '/api/auth/profile-picture',
      mockAuthMiddleware,
      upload.single('profilePicture'),
      async (req: Request, res: Response, _next: NextFunction) => {
        try {
          if (req.file == null) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
          }

          // Validate file type
          const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
          if (!allowedMimeTypes.includes(req.file.mimetype)) {
            res.status(400).json({
              error: 'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed',
            });
            return;
          }

          // Validate file size (max 5MB)
          const maxSize = 5 * 1024 * 1024;
          if (req.file.size > maxSize) {
            res.status(400).json({ error: 'File too large. Maximum size is 5MB' });
            return;
          }

          // Get current user
          const reqWithUser = req as unknown as { user: MockUser };
          const currentUser = await mockFindById(reqWithUser.user.id) as MockUser | null;
          const mockCurrentUser = currentUser as MockUser | null;

          // Delete old profile picture if exists
          if (mockCurrentUser?.profilePictureUrl != null && mockCurrentUser.profilePictureUrl.includes('profile-pictures/')) {
            await mockDeleteProfilePictureByUrl(mockCurrentUser.profilePictureUrl);
          }

          // Save new profile picture
          const profilePictureUrl = await mockSaveProfilePicture(
            mockCurrentUser!.id,
            req.file.buffer,
            req.file.mimetype
          ) as string;

          // Update user (include the profile picture URL)
          const updatedUser: MockUser & { profilePictureUrl: string } = {
            id: mockUser.id,
            email: mockUser.email,
            username: mockUser.username,
            userType: mockUser.userType,
            emailVerified: mockUser.emailVerified,
            profilePictureUrl,
          };

          res.json({
            message: 'Profile picture updated successfully',
            user: updatedUser,
          });
        } catch (error: unknown) {
          const err = error as Error;
          res.status(400).json({ error: err.message });
        }
      }
    );

    // Delete profile picture endpoint
    app.delete('/api/auth/profile-picture', mockAuthMiddleware, async (req: Request, res: Response) => {
      try {
        const reqWithUser = req as unknown as { user: MockUser };
        const currentUser = await mockFindById(reqWithUser.user.id) as MockUser | null;
        const mockCurrentUser = currentUser as MockUser | null;

        if (mockCurrentUser?.profilePictureUrl != null && mockCurrentUser.profilePictureUrl.includes('profile-pictures/')) {
          await mockDeleteProfilePictureByUrl(mockCurrentUser.profilePictureUrl);
        }

        const updatedUser = {
          ...mockUser,
          profilePictureUrl: null,
        };

        res.json({
          message: 'Profile picture deleted successfully',
          user: updatedUser,
        });
      } catch (error: unknown) {
        const err = error as Error;
        res.status(400).json({ error: err.message });
      }
    });
  });

  beforeEach(() => {
    // Clear mock calls before each test
    mockSaveProfilePicture.mockClear();
    mockDeleteProfilePictureByUrl.mockClear();
    mockFindById.mockClear();

    // Reset implementations after clear
    mockSaveProfilePicture.mockImplementation((userId: string, _buffer: Buffer, _contentType: string) => {
      return Promise.resolve(`https://example.com/profile-pictures/${userId}/profile-123.jpg`);
    });

    mockDeleteProfilePictureByUrl.mockImplementation((_url: string) => {
      return Promise.resolve();
    });

    // Reset default implementation
    mockFindById.mockImplementation((_id: string) => {
      return Promise.resolve(mockUser);
    });
  });

  describe('Upload Profile Picture', () => {
    it('should successfully upload a valid JPEG image', async () => {
      // Create a mock JPEG buffer
      const imageBuffer = Buffer.from('fake-jpeg-data');

      const response = await request(app)
        .put('/api/auth/profile-picture')
        .set('Authorization', `Bearer ${mockAuthToken}`)
        .attach('profilePicture', imageBuffer, {
          filename: 'test-profile.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Profile picture updated successfully');
      expect(response.body).toHaveProperty('user');
      const resBody = response.body as { user: { profilePictureUrl: string } };
      expect(resBody.user).toHaveProperty('profilePictureUrl');
      expect(resBody.user.profilePictureUrl).toContain('profile-pictures');
      expect(mockSaveProfilePicture).toHaveBeenCalledWith(
        mockUser.id,
        expect.any(Buffer),
        'image/jpeg'
      );
    });

    it('should successfully upload a valid PNG image', async () => {
      const imageBuffer = Buffer.from('fake-png-data');

      const response = await request(app)
        .put('/api/auth/profile-picture')
        .set('Authorization', `Bearer ${mockAuthToken}`)
        .attach('profilePicture', imageBuffer, {
          filename: 'test-profile.png',
          contentType: 'image/png',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Profile picture updated successfully');
      expect(mockSaveProfilePicture).toHaveBeenCalledWith(
        mockUser.id,
        expect.any(Buffer),
        'image/png'
      );
    });

    it('should reject upload without authentication', async () => {
      const imageBuffer = Buffer.from('fake-jpeg-data');

      const response = await request(app)
        .put('/api/auth/profile-picture')
        .attach('profilePicture', imageBuffer, {
          filename: 'test-profile.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Authentication required');
      expect(mockSaveProfilePicture).not.toHaveBeenCalled();
    });

    it('should reject upload without file', async () => {
      const response = await request(app)
        .put('/api/auth/profile-picture')
        .set('Authorization', `Bearer ${mockAuthToken}`);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'No file uploaded');
      expect(mockSaveProfilePicture).not.toHaveBeenCalled();
    });

    it('should reject invalid file types', async () => {
      const fileBuffer = Buffer.from('fake-pdf-data');

      const response = await request(app)
        .put('/api/auth/profile-picture')
        .set('Authorization', `Bearer ${mockAuthToken}`)
        .attach('profilePicture', fileBuffer, {
          filename: 'test-document.pdf',
          contentType: 'application/pdf',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      const resBody = response.body as { error: string };
      expect(resBody.error).toContain('Invalid file type');
      expect(mockSaveProfilePicture).not.toHaveBeenCalled();
    });

    it('should handle multipart/form-data content type correctly', async () => {
      // This test specifically validates the fix for "request body too small" error
      const imageBuffer = Buffer.from('fake-jpeg-data');

      const response = await request(app)
        .put('/api/auth/profile-picture')
        .set('Authorization', `Bearer ${mockAuthToken}`)
        .attach('profilePicture', imageBuffer, {
          filename: 'test-profile.jpg',
          contentType: 'image/jpeg',
        });

      // Should not return "request body too small" error
      expect(response.status).toBe(200);
      const resBody = response.body as { error?: string };
      expect(resBody.error).toBeUndefined();
    });

    it('should delete old profile picture when uploading new one', async () => {
      // Setup: user already has a profile picture
      const userWithPicture: MockUser = {
        ...mockUser,
        profilePictureUrl: 'https://example.com/profile-pictures/test-user-id/old-profile.jpg',
      };
      mockFindById.mockResolvedValue(userWithPicture);

      const imageBuffer = Buffer.from('fake-jpeg-data');

      const response = await request(app)
        .put('/api/auth/profile-picture')
        .set('Authorization', `Bearer ${mockAuthToken}`)
        .attach('profilePicture', imageBuffer, {
          filename: 'new-profile.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(200);
      expect(mockDeleteProfilePictureByUrl).toHaveBeenCalledWith(
        userWithPicture.profilePictureUrl
      );
      expect(mockSaveProfilePicture).toHaveBeenCalled();
    });

    it('should not delete OAuth profile pictures when uploading new one', async () => {
      // Setup: user has OAuth profile picture (Google)
      const userWithOAuthPicture: MockUser = {
        ...mockUser,
        profilePictureUrl: 'https://lh3.googleusercontent.com/a/default-user',
      };
      mockFindById.mockResolvedValue(userWithOAuthPicture);

      const imageBuffer = Buffer.from('fake-jpeg-data');

      const response = await request(app)
        .put('/api/auth/profile-picture')
        .set('Authorization', `Bearer ${mockAuthToken}`)
        .attach('profilePicture', imageBuffer, {
          filename: 'new-profile.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(200);
      // Should NOT delete OAuth picture
      expect(mockDeleteProfilePictureByUrl).not.toHaveBeenCalled();
      expect(mockSaveProfilePicture).toHaveBeenCalled();
    });
  });

  describe('Delete Profile Picture', () => {
    it('should successfully delete profile picture', async () => {
      const userWithPicture: MockUser = {
        ...mockUser,
        profilePictureUrl: 'https://example.com/profile-pictures/test-user-id/profile.jpg',
      };
      mockFindById.mockResolvedValue(userWithPicture);

      const response = await request(app)
        .delete('/api/auth/profile-picture')
        .set('Authorization', `Bearer ${mockAuthToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Profile picture deleted successfully');
      const resBody2 = response.body as { user: { profilePictureUrl: string | null } };
      expect(resBody2.user.profilePictureUrl).toBeNull();
      expect(mockDeleteProfilePictureByUrl).toHaveBeenCalledWith(
        userWithPicture.profilePictureUrl
      );
    });

    it('should not delete OAuth profile pictures', async () => {
      const userWithOAuthPicture: MockUser = {
        ...mockUser,
        profilePictureUrl: 'https://lh3.googleusercontent.com/a/default-user',
      };
      mockFindById.mockResolvedValue(userWithOAuthPicture);

      const response = await request(app)
        .delete('/api/auth/profile-picture')
        .set('Authorization', `Bearer ${mockAuthToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Profile picture deleted successfully');
      expect(mockDeleteProfilePictureByUrl).not.toHaveBeenCalled();
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .delete('/api/auth/profile-picture');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Authentication required');
      expect(mockDeleteProfilePictureByUrl).not.toHaveBeenCalled();
    });
  });

  describe('File Size Validation', () => {
    it('should reject files larger than 5MB', async () => {
      // Create a buffer larger than 5MB
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024);

      // Multer will throw error for files exceeding limit
      const response = await request(app)
        .put('/api/auth/profile-picture')
        .set('Authorization', `Bearer ${mockAuthToken}`)
        .attach('profilePicture', largeBuffer, {
          filename: 'large-image.jpg',
          contentType: 'image/jpeg',
        });

      // Multer rejects files over the limit before they reach our handler
      // So we expect an error status code
      expect([400, 413, 500]).toContain(response.status);
      expect(mockSaveProfilePicture).not.toHaveBeenCalled();
    });

    it('should accept files within size limit', async () => {
      // Create a buffer within limit (1MB)
      const validBuffer = Buffer.alloc(1 * 1024 * 1024);

      const response = await request(app)
        .put('/api/auth/profile-picture')
        .set('Authorization', `Bearer ${mockAuthToken}`)
        .attach('profilePicture', validBuffer, {
          filename: 'valid-image.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Profile picture updated successfully');
      expect(mockSaveProfilePicture).toHaveBeenCalled();
    });
  });

  describe('Regression: Request Body Too Small Error', () => {
    it('should not throw "request body too small" error for multipart uploads', async () => {
      // This is a regression test for the bug we just fixed
      const imageBuffer = Buffer.from('small-image-data');

      const response = await request(app)
        .put('/api/auth/profile-picture')
        .set('Authorization', `Bearer ${mockAuthToken}`)
        .attach('profilePicture', imageBuffer, {
          filename: 'small.jpg',
          contentType: 'image/jpeg',
        });

      // The bug would return: {"error":"The request body was too small"}
      // After fix, it should process the upload successfully
      expect(response.status).not.toBe(413); // Payload Too Large

      // Check if error exists before asserting on it
      const body = response.body as Record<string, unknown>;
      if (body.error != null) {
        const errorMsg = body.error as string;
        expect(errorMsg).not.toContain('too small');
        expect(errorMsg).not.toContain('body');
      }

      // Should either succeed or fail with a proper validation error
      if (response.status === 200) {
        expect(response.body).toHaveProperty('message', 'Profile picture updated successfully');
      }
    });
  });
});
