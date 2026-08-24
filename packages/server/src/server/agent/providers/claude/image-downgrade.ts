import fs from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { z } from "zod";

const CONFIG_FILENAME = "claude-image-downgrade.json";

const ImageDowngradeConfigSchema = z.object({
  mode: z.enum(["off", "on"]),
});

/**
 * One-time migration of the pre-UI switch file $PASEO_HOME/claude-image-downgrade.json.
 * Reads it, deletes it, returns the mode ("on") or null (absent/invalid → keep default "off").
 * Never throws on read/parse failures.
 */
export function migrateLegacyImageDowngrade(
  paseoHome: string,
  logger: Logger,
): "on" | null {
  const file = path.join(paseoHome, CONFIG_FILENAME);

  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    // Absent config = default "off". Not an error; stay silent.
    return null;
  }

  try {
    fs.unlinkSync(file);
  } catch (error) {
    logger.warn({ file, err: error }, "Failed to remove legacy claude-image-downgrade.json");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    logger.warn(
      { file, err: error },
      "Legacy image-downgrade config is not valid JSON; ignoring",
    );
    return null;
  }

  const result = ImageDowngradeConfigSchema.safeParse(parsedJson);
  if (!result.success) {
    logger.warn(
      { file, issues: result.error.issues },
      "Legacy image-downgrade config invalid; ignoring",
    );
    return null;
  }

  return result.data.mode === "on" ? "on" : null;
}
