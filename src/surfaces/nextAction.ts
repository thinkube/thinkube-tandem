/**
 * The one next action: always in the same place, and it says what will
 * happen when it is pressed.
 *
 * Every state of the surface answers the same three questions — what did I
 * ask, what is happening, what do I press — and this is the answer to the
 * third, decided once from the push rather than by whichever page happens
 * to be showing. A page that offered its own buttons in its own words left
 * the person to work out which of four pages held the thing to do next.
 */
import type { SpacePush, WebToHost } from "./surfaceContract";
import type { SurfacePage } from "./surfaceLayout";
import { asksOfText } from "../derive/asks";

/** What pressing it does: a governed message to the host, or a move. */
type NextMove =
  | { kind: "post"; action: WebToHost }
  | { kind: "tab"; tab: SurfacePage }
  | { kind: "none" };

export interface NextAction {
  /** Where the space is, in the person's terms — beside the project name. */
  where: string;
  /** The button's text: what will happen. */
  label: string;
  /** Beside the button: the cost, the size, or why it cannot be pressed. */
  hint: string;
  enabled: boolean;
  move: NextMove;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * The sets in the order they should be built: the ones still to build
 * first, largest first; what is built comes last, behind you.
 */
export function setsInOrder(push: SpacePush): NonNullable<SpacePush["specs"]> {
  return [...(push.specs ?? [])].sort((a, b) => {
    if (a.built !== b.built) return a.built ? 1 : -1;
    return b.promises - a.promises;
  });
}

export function nextAction(
  push: SpacePush,
  a: {
    /** The reading of the draft is behind the words in the box. */
    behind: boolean;
    /** Whether the phase allows a governed action right now. */
    allowed: (action: string) => boolean;
  },
): NextAction {
  const sentences = push.sentences.length;
  const chosen = (push.specs ?? []).find((sp) => sp.chosen);

  if (push.running)
    return {
      where: `building — ${chosen?.name ?? "the work you signed"}`,
      label: "Stop",
      hint: "stops the workers · nothing is decided",
      enabled: a.allowed("stop-run"),
      move: { kind: "post", action: { action: "stop-run" } },
    };

  const working = !!push.activity || (push.grounding?.length ?? 0) > 0;
  if (working)
    return {
      where: "working out what to build",
      label: "Working it out…",
      hint: "you stay here until every subject is done — then the work page opens by itself",
      enabled: false,
      move: { kind: "none" },
    };

  if (push.pendingModel) {
    const n = push.pendingModel.fresh.length;
    return a.behind
      ? {
          where: `${plural(sentences + n, "sentence")} · the reading is behind the words`,
          label: "Read it again",
          hint: "you changed the words since they were read",
          enabled: a.allowed("read-draft"),
          move: { kind: "post", action: { action: "read-draft" } },
        }
      : {
          where: `${plural(n, "sentence")} read, not kept`,
          label: `Keep these ${n}`,
          hint: "recorded word for word · costs nothing · nothing is built yet",
          enabled: true,
          move: { kind: "post", action: { action: "keep-draft" } },
        };
  }

  const delivered = push.deliveries.find((d) => !d.accepted);
  if (delivered)
    return {
      where: `delivered — waiting for you to read it`,
      label: "Read what came back",
      hint: "what was made true, and the decision left to you",
      enabled: true,
      move: { kind: "tab", tab: "flow" },
    };

  if (sentences === 0) {
    const written = asksOfText(push.draft ?? "").length;
    return written
      ? {
          where: `${plural(written, "line")} written, none read`,
          label: `Read these ${written}`,
          hint: "costs one round · records nothing",
          enabled: a.allowed("read-draft"),
          move: { kind: "post", action: { action: "read-draft" } },
        }
      : {
          where: "nothing written yet",
          label: "Read it",
          hint: "write a line, then read",
          enabled: false,
          move: { kind: "none" },
        };
  }

  if (push.subjects.length === 0)
    return {
      where: `${plural(sentences, "sentence")} written, none read`,
      label: `Read these ${sentences}`,
      hint: "costs one round · records nothing",
      enabled: true,
      move: { kind: "post", action: { action: "retry-model" } },
    };

  const sets = setsInOrder(push);
  if (sets.length === 0)
    return {
      where: `${plural(sentences, "sentence")} · not grouped yet`,
      label: "Group into things to build",
      hint: "so each one can be built and looked at on its own",
      enabled: a.allowed("group-into-sets"),
      move: { kind: "post", action: { action: "group-into-sets" } },
    };

  const toBuild = sets.filter((sp) => !sp.built);
  if (!chosen) {
    const first = toBuild[0];
    if (!first)
      return {
        where: `${plural(sentences, "sentence")} · everything is built`,
        label: "Everything is built",
        hint: "write a new line to ask for more",
        enabled: false,
        move: { kind: "none" },
      };
    const carries = first.asks?.length ?? first.subjects;
    return {
      where: `${plural(sentences, "sentence")} · ${plural(toBuild.length, "thing")} to build`,
      label: "Build the first",
      hint: `${carries} of your ${carries === 1 ? "sentence" : "sentences"} · nothing is written until you sign`,
      enabled: a.allowed("choose-set"),
      move: { kind: "post", action: { action: "choose-set", specId: first.id } },
    };
  }

  if (push.cost.subjects > 0)
    return {
      where: `${chosen.name} — not worked out yet`,
      label: "See what it will do",
      hint: `${plural(push.cost.subjects, "subject")} to think about — about ${plural(push.cost.rounds, "round")}`,
      enabled: a.allowed("think"),
      move: { kind: "post", action: { action: "think" } },
    };

  if (push.signedIdle)
    return {
      where: `${chosen.name} — ${push.signedIdle.heading}`,
      label: "See the run",
      hint: push.signedIdle.sentence,
      enabled: true,
      move: { kind: "tab", tab: "flow" },
    };

  const promises = push.ready.promises;
  return {
    where: `${chosen.name} — ${plural(promises, "promise")}, not started`,
    label: `Build these ${promises}`,
    hint: "the price is said on the work page before you sign",
    enabled: true,
    move: { kind: "tab", tab: "work" },
  };
}
