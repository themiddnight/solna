import { lazy } from "react";
import { AuthLayout } from "@/shared/layouts/AuthLayout";
import { MainLayout } from "@/shared/layouts/MainLayout";
import {
  AuthGuard,
  GuestGuard,
  OfflineGuard,
} from "@/shared/components/guards";
import { PATHS, ROUTE_PATTERNS } from "@/shared/constants";

// ===== Special Pages =====
const Offline = lazy(() => import("../../pages/Offline"));

// ===== Auth Pages =====
const Login = lazy(() => import("../../pages/Login"));
const Register = lazy(() => import("../../pages/Register"));
const AuthCallback = lazy(() => import("../../pages/AuthCallback"));
const AuthPopupStart = lazy(() => import("../../pages/AuthPopupStart"));
const ResetPassword = lazy(() => import("../../pages/ResetPassword"));

// ===== Main App Pages =====
const Lobby = lazy(() => import("../../pages/Lobby"));
const Profile = lazy(() => import("../../pages/Profile"));
const BandDetail = lazy(() => import("../../pages/BandDetail"));
const Community = lazy(() => import("../../pages/Community"));
const AccountSettings = lazy(() => import("../../pages/AccountSettings"));
const ManagePlan = lazy(() => import("../../pages/ManagePlan"));

// ===== Room Pages =====
const PerformRoom = lazy(() => import("../../pages/PerformRoom"));
const AudienceRoom = lazy(() => import("../../pages/AudienceRoom"));
const ArrangeRoom = lazy(() => import("../../pages/ArrangeRoom"));

// ===== Invite & Join Pages =====
const Invite = lazy(() => import("../../pages/Invite"));
const JoinBand = lazy(() => import("../../pages/JoinBand"));
const ProjectShare = lazy(() => import("../../pages/ProjectShare"));

// ===== Dev-only Routes =====
// The lazy import lives inside this ternary so that in production builds
// (import.meta.env.DEV === false) the whole branch — including the dynamic
// import — is dead-code-eliminated and no chunk is emitted for it.
const devRoutes: AppRoute[] = import.meta.env.DEV
  ? [
      {
        path: PATHS.LOADER,
        component: lazy(() => import("../../pages/LoaderPreview")),
      },
      {
        path: PATHS.CALIBRATION_HARNESS,
        component: lazy(() => import("../../pages/dev/CalibrationHarnessPage")),
      },
    ]
  : [];

export const routes = [
  // ===== Special Routes =====
  {
    path: PATHS.OFFLINE,
    component: Offline,
    guard: OfflineGuard,
  },

  // ===== Auth Routes =====
  // Guest-only routes with AuthLayout (shared ambient particle background)
  {
    path: PATHS.LOGIN,
    component: Login,
    layout: AuthLayout,
    guard: GuestGuard,
  },
  {
    path: PATHS.REGISTER,
    component: Register,
    layout: AuthLayout,
    guard: GuestGuard,
  },
  {
    path: PATHS.AUTH_CALLBACK,
    component: AuthCallback,
  },
  {
    path: PATHS.AUTH_POPUP_START,
    component: AuthPopupStart,
  },
  {
    path: PATHS.RESET_PASSWORD,
    component: ResetPassword,
    layout: MainLayout,
  },

  // ===== Main App Routes =====
  {
    path: PATHS.HOME,
    component: Lobby,
    layout: MainLayout,
  },
  {
    path: PATHS.PROFILE,
    component: Profile,
    layout: MainLayout,
    guard: AuthGuard,
  },
  {
    path: ROUTE_PATTERNS.PROFILE_BAND,
    component: BandDetail,
    layout: MainLayout,
    guard: AuthGuard,
  },
  {
    path: PATHS.COMMUNITY,
    component: Community,
    layout: MainLayout,
    guard: AuthGuard,
  },
  {
    path: PATHS.ACCOUNT,
    component: AccountSettings,
    layout: MainLayout,
    guard: AuthGuard,
  },
  {
    path: PATHS.ACCOUNT_BILLING,
    component: ManagePlan,
    layout: MainLayout,
    guard: AuthGuard,
  },

  // ===== Room Routes =====
  {
    path: ROUTE_PATTERNS.PERFORM_ROOM,
    component: PerformRoom,
  },
  {
    path: ROUTE_PATTERNS.PERFORM_ROOM_AUDIENCE,
    component: AudienceRoom,
  },
  {
    path: ROUTE_PATTERNS.ARRANGE_ROOM,
    component: ArrangeRoom,
  },

  // ===== Invite & Join Routes =====
  {
    path: ROUTE_PATTERNS.INVITE,
    component: Invite,
  },
  {
    path: ROUTE_PATTERNS.JOIN_BAND,
    component: JoinBand,
  },
  {
    path: ROUTE_PATTERNS.PROJECT_SHARE,
    component: ProjectShare,
  },

  // ===== Dev-only Routes =====
  ...devRoutes,

  // ===== Fallback Route =====
  {
    path: PATHS.FALLBACK,
    component: Lobby,
  },
];

export type AppRoute = {
  path: string;
  component: React.ComponentType<unknown>;
  layout?: React.ComponentType<unknown>;
  guard?: React.ComponentType<{
    children: React.ReactNode;
    redirectTo?: string;
  }>;
};
