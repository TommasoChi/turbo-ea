import { afterAll, beforeAll, vi } from "vitest";

/**
 * Pins the default locale of `Intl.NumberFormat` to en-US for the calling test
 * file, so figures render the same on a machine whose system language uses a
 * decimal comma ("1,4 k" instead of "1.4 k"). A locale passed explicitly is left
 * alone.
 */
export function pinEnglishNumberFormat(): void {
  const RealNumberFormat = Intl.NumberFormat;
  let spy: ReturnType<typeof vi.spyOn> | undefined;

  beforeAll(() => {
    spy = vi.spyOn(Intl, "NumberFormat").mockImplementation(function (
      locales?: Intl.LocalesArgument,
      options?: Intl.NumberFormatOptions,
    ) {
      return new RealNumberFormat(locales ?? "en-US", options);
    } as unknown as typeof Intl.NumberFormat);
  });

  afterAll(() => {
    spy?.mockRestore();
  });
}
