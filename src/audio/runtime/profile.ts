type AudioEngineFamily = 'webkit' | 'chromium' | 'gecko' | 'unknown';

type RuntimePlatform = 'ios' | 'macos' | 'windows' | 'android' | 'linux' | 'unknown';

export interface RuntimeProfile {
  engine: AudioEngineFamily;
  platform: RuntimePlatform;
  standalone: boolean;
  userAgent: string;
}

export interface RuntimeEnvironment {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
}

export function detectRuntimeProfile(environment: RuntimeEnvironment): RuntimeProfile {
  const platform = detectPlatform(environment);

  return {
    engine: detectEngine(environment.userAgent, platform),
    platform,
    standalone: environment.standalone,
    userAgent: environment.userAgent,
  };
}

function detectPlatform(environment: RuntimeEnvironment): RuntimePlatform {
  const { platform, maxTouchPoints, userAgent } = environment;

  if (platform === 'MacIntel' && maxTouchPoints > 1) return 'ios';
  if (/iPhone|iPad|iPod/i.test(userAgent) || /iPhone|iPad|iPod/i.test(platform)) return 'ios';
  if (/Android/i.test(userAgent) || /Android/i.test(platform)) return 'android';
  if (/Win/i.test(platform) || /Windows/i.test(userAgent)) return 'windows';
  if (/Mac/i.test(platform) || /Mac OS X/i.test(userAgent)) return 'macos';
  if (/Linux/i.test(platform) || /Linux/i.test(userAgent)) return 'linux';
  return 'unknown';
}

function detectEngine(userAgent: string, platform: RuntimePlatform): AudioEngineFamily {
  if (platform === 'ios' && /AppleWebKit/i.test(userAgent)) return 'webkit';
  if (/Chrome|Chromium|Edg\//i.test(userAgent)) return 'chromium';
  if (/Firefox|Gecko\//i.test(userAgent)) return 'gecko';
  if (/AppleWebKit/i.test(userAgent)) return 'webkit';
  return 'unknown';
}
