import { resolveFlag, dismissFlag } from "./actions";
import type { FlagWithContext } from "./page";
import { CuisineAssignment } from "./CuisineAssignment";
import { ManualReassign } from "./ManualReassign";
import { MissingCuisineActions } from "./MissingCuisineActions";

/**
 * Build a Reddit URL that scrolls to the specific comment. Without this,
 * deeply-nested comments are hidden under "load more" in Reddit's UI and
 * appear missing — confused us during the first admin review pass.
 *
 * Reddit fullnames have a `t1_` (comment) prefix that doesn't belong in URLs.
 */
function commentPermalink(threadUrl: string, commentRedditId: string): string {
  const id = commentRedditId.replace(/^t1_/, "");
  return `${threadUrl.replace(/\/$/, "")}/${id}/`;
}

const SENTIMENT_COLOR: Record<string, string> = {
  positive: "text-green-700 dark:text-green-400",
  negative: "text-red-700 dark:text-red-400",
  mixed: "text-amber-700 dark:text-amber-400",
};

/**
 * Server component. Dispatches on flag.kind because each kind has a
 * different review action (resolve/dismiss vs. assign cuisines).
 */
export function FlagCard({ flag }: { flag: FlagWithContext }) {
  if (flag.kind === "missing_cuisine") {
    return <MissingCuisineCard flag={flag} />;
  }
  return <LowConfidenceCard flag={flag} />;
}

function LowConfidenceCard({ flag }: { flag: FlagWithContext }) {
  const ext = flag.extraction;
  const rest = flag.restaurant;
  const comment = ext?.comment ?? null;
  const thread = comment?.thread ?? null;

  const mention = ext?.mention_text ?? "(unknown)";
  const food = ext?.food_sentiment;
  const service = ext?.service_sentiment;
  const quote = ext?.quote_original;
  const conf = ext?.resolution_confidence;

  return (
    <article className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="text-xs uppercase tracking-wide text-gray-500">{flag.kind}</div>
        <div className="text-xs text-gray-500">
          conf {typeof conf === "number" ? conf.toFixed(2) : "?"}
        </div>
      </div>

      <div className="flex gap-3 items-baseline">
        <h2 className="text-lg font-bold">{mention}</h2>
        {ext?.neighborhood_hint && (
          <span className="text-sm text-gray-500">({ext.neighborhood_hint})</span>
        )}
      </div>

      <div className="flex gap-4 mt-1 text-sm">
        <span>
          <span className="text-gray-500">food </span>
          <span className={food ? SENTIMENT_COLOR[food] : "text-gray-400"}>{food ?? "—"}</span>
        </span>
        <span>
          <span className="text-gray-500">service </span>
          <span className={service ? SENTIMENT_COLOR[service] : "text-gray-400"}>
            {service ?? "—"}
          </span>
        </span>
      </div>

      {quote && (
        <blockquote className="mt-3 text-sm italic text-gray-600 dark:text-gray-400 border-l-2 border-gray-300 dark:border-gray-700 pl-3">
          “{quote}”
        </blockquote>
      )}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
            Resolver guessed
          </div>
          {rest ? (
            <>
              <div className="font-medium">{rest.name}</div>
              {rest.address && <div className="text-gray-500 text-xs">{rest.address}</div>}
              {rest.website && (
                <a
                  href={rest.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 dark:text-blue-400 text-xs hover:underline"
                >
                  {new URL(rest.website).host}
                </a>
              )}
            </>
          ) : (
            <div className="text-gray-400 italic">No candidate</div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Source</div>
          {thread ? (
            <>
              <div>r/{thread.subreddit}</div>
              <a
                href={thread.url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 dark:text-blue-400 text-xs hover:underline line-clamp-2"
              >
                {thread.title}
              </a>
            </>
          ) : (
            <div className="text-gray-400 italic">no source</div>
          )}
          {comment?.author && thread?.url && comment.reddit_id && (
            <a
              href={commentPermalink(thread.url, comment.reddit_id)}
              target="_blank"
              rel="noreferrer"
              className="text-gray-500 text-xs mt-1 hover:underline block"
              title="Direct link to the specific comment (handles nested replies)"
            >
              u/{comment.author} →
            </a>
          )}
          {comment?.author && (!thread?.url || !comment.reddit_id) && (
            <div className="text-gray-500 text-xs mt-1">u/{comment.author}</div>
          )}
        </div>
      </div>

      {comment?.body && (
        <details className="mt-3">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
            Show full comment
          </summary>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
            {comment.body}
          </div>
        </details>
      )}

      <div className="mt-5 flex gap-2 justify-end items-center flex-wrap">
        {thread?.city_slug && (
          <ManualReassign flagId={flag.id} citySlug={thread.city_slug} />
        )}
        <form action={dismissFlag}>
          <input type="hidden" name="flagId" value={flag.id} />
          <button
            type="submit"
            className="text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900"
          >
            Dismiss (false positive)
          </button>
        </form>
        <form action={resolveFlag}>
          <input type="hidden" name="flagId" value={flag.id} />
          <button
            type="submit"
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5"
          >
            Mark resolved
          </button>
        </form>
      </div>
    </article>
  );
}

/**
 * Card for `kind = missing_cuisine` — Google Places types didn't map to any
 * of our 26 cuisines, so we ask the admin to pick the right one(s).
 */
function MissingCuisineCard({
  flag,
}: {
  flag: FlagWithContext & { restaurant_id?: string | null };
}) {
  const rest = flag.restaurant;
  const fallbackName =
    typeof flag.details?.restaurant_name === "string"
      ? (flag.details.restaurant_name as string)
      : "(unknown restaurant)";

  // The page query selects flag.restaurant via FK, but the FK column itself
  // (restaurant_id) isn't included. Flags with kind=missing_cuisine always
  // have it — pull it from the embedded restaurant row's id.
  const restaurantId = (flag as { restaurant?: { id?: string } | null }).restaurant?.id;

  return (
    <article className="border border-gray-200 dark:border-gray-800 rounded-lg p-5">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-3">
        {flag.kind}
      </div>

      <div className="mb-4">
        <h2 className="text-lg font-bold">{rest?.name ?? fallbackName}</h2>
        {rest?.address && (
          <div className="text-sm text-gray-500 mt-0.5">{rest.address}</div>
        )}
        {rest?.website && (
          <a
            href={rest.website}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 dark:text-blue-400 text-xs hover:underline"
          >
            {(() => {
              try {
                return new URL(rest.website).host;
              } catch {
                return rest.website;
              }
            })()}
          </a>
        )}
      </div>

      <CuisineAssignment flagId={flag.id} />

      {restaurantId && (
        <div className="mt-4 border-t border-gray-200 dark:border-gray-800 pt-3">
          <MissingCuisineActions
            flagId={flag.id}
            restaurantId={restaurantId}
            currentWebsite={rest?.website ?? null}
          />
        </div>
      )}
    </article>
  );
}
