import { routes, type AppRoute } from "./app-config";
import { PWAUpdatePrompt, ErrorBoundary } from "./shared";
import { SignupModal, InRoomAuthPromptModal } from "@/features/auth";
import { TourOverlay, useMarkTourPromptedOnConversion } from "@/features/onboarding-tour";
import { ThemeInitializer } from "./shared/components/ThemeInitializer";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { useDeepLinkHandler } from "./shared/hooks/useDeepLinkHandler";
import { useTrackRoomReturnOrigin } from "@/features/rooms/shared/hooks/useTrackRoomReturnOrigin";
import { useShareLinkResume } from "@/features/rooms/shared/hooks/useShareLinkResume";
import { useHealthCheck } from "./shared/hooks/useHealthCheck";
import { usePresetSync } from "@/features/sequencer/hooks/usePresetSync";
import { useUserPreferencesSync } from "@/features/user-preferences";
import { getSavedLocale, dynamicActivate } from "./shared/utils/i18n";
import { queryClient } from "./shared/utils/queryClient";
import { ProjectPresenceProvider } from "@/features/projects";
import { LogoLoader, Tooltip } from "@/features/ui";
import { ToastNotification } from "@/shared/components/ToastNotification";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, Suspense, useState } from "react";
import { Routes, Route } from "react-router-dom";

export default function App() {
  const [isI18nLoaded, setIsI18nLoaded] = useState(false);
  const { checkAuth } = useAuth();

  // Initialize i18n
  useEffect(() => {
    const locale = getSavedLocale();
    void dynamicActivate(locale).then(() => {
      setIsI18nLoaded(true);
    });
  }, []);

  // Check backend health before anything else
  useHealthCheck();

  // Initialize deep link handling
  useDeepLinkHandler();

  // Record where the user came from so leaving a room returns them there
  // (Community / Band / Profile / Lobby) instead of always jumping to the lobby.
  useTrackRoomReturnOrigin();

  // Resume a pending project-share open after the signup/verify auth detour
  useShareLinkResume();

  // Sync presets with API when authenticated
  usePresetSync();

  // Hydrate + commit tier-4 user preferences when authenticated (TR-41)
  useUserPreferencesSync();

  // Persist "tour prompted" when a guest upgrades to a real account mid-tour (DEV-220), so the
  // tour is never redundantly re-offered to the freshly-created account.
  useMarkTourPromptedOnConversion();

  // Restore login state from token on app start
  useLayoutEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    // Clear error recovery flag on successful app load
    sessionStorage.removeItem("error-recovery-attempted");

    // Re-check auth on window focus/visibility change
    const handleRevalidation = () => {
      if (document.visibilityState === "visible") {
        void checkAuth();
      }
    };

    window.addEventListener("focus", handleRevalidation);
    document.addEventListener("visibilitychange", handleRevalidation);

    return () => {
      window.removeEventListener("focus", handleRevalidation);
      document.removeEventListener("visibilitychange", handleRevalidation);
    };
  }, [checkAuth]);

  if (!isI18nLoaded) {
    return (
      <div className="flex h-dvh w-full items-center justify-center">
        <LogoLoader />
      </div>
    );
  }

  return (
    <I18nProvider i18n={i18n}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <Tooltip.Provider>
            <ThemeInitializer />
            <ProjectPresenceProvider>
              <Suspense
                fallback={
                  <div className="flex h-dvh w-full items-center justify-center">
                    <LogoLoader />
                  </div>
                }
              >
                <Routes>
                  {routes.map(({ path, component, layout, guard }: AppRoute) => {
                    const RouteComponent = component;
                    const RouteGuard = guard;
                    const RouteLayout = layout;
                    let componentElement = <RouteComponent />;

                    if (RouteGuard) {
                      componentElement = (
                        <RouteGuard>{componentElement}</RouteGuard>
                      );
                    }

                    if (RouteLayout) {
                      return (
                        <Route key={path} element={<RouteLayout />}>
                          <Route path={path} element={componentElement} />
                        </Route>
                      );
                    }

                    return (
                      <Route key={path} path={path} element={componentElement} />
                    );
                  })}
                </Routes>
              </Suspense>
              <PWAUpdatePrompt />
              <ToastNotification />
              <SignupModal />
              <InRoomAuthPromptModal />
              <TourOverlay />
            </ProjectPresenceProvider>
          </Tooltip.Provider>
        </QueryClientProvider>
      </ErrorBoundary>
    </I18nProvider>
  );
}
