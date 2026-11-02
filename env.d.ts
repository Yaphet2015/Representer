interface ImportMetaEnv {
  /** GA4 Measurement Protocol api secret, injected at build time (CI secret); unset → analytics is a no-op */
  readonly WXT_GA_API_SECRET?: string;
}
