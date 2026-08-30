/**
 * The delivery, written out for a person to read.
 *
 * The one page where what was promised, what was proved, and what is still
 * out are put side by side — so accepting is a reading, not a leap.
 *
 * `surfaceText` is the built webview surface, read once by the caller and
 * held for every delivery on this push — never re-read here per delivery.
 */
import { doorsBySentence, renderDeliveryPage } from "../gates/render";
import type { TandemSession } from "./session";

export function deliveryPageOf(s: TandemSession, deliveryId: string, surfaceText: string): string | undefined {
  const d = s.space.deliveries.find((x) => x.id === deliveryId);
  if (!d) return undefined;
  return renderDeliveryPage(s.space, d, doorsBySentence(s.space.nodes, surfaceText));
}
