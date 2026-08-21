import type { LinguiConfig } from "@lingui/conf";
import { formatter } from "@lingui/format-po";

const config: LinguiConfig = {
  locales: ["en", "th"],
  sourceLocale: "en",
  catalogs: [
    {
      path: "src/locales/{locale}/messages",
      include: ["src"],
    },
  ],
  format: formatter({ lineNumbers: false }),
};

export default config;
