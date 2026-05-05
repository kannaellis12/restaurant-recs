import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { CityRequest } from "../CityRequest";

/**
 * About / how-it-works page.
 *
 * The copy below is written as plain text inside <p> tags so it can be
 * edited in place. Section markers (---- INTRO ----, ---- STEP 1 ----, etc.)
 * are commented above each block to make them easy to find. Type over
 * the existing prose; the layout will reflow.
 *
 * Typography vocabulary matches the rest of the site:
 *   - mono uppercase chip with the accent dot for section eyebrows
 *   - font-display + italic accent flourish for headlines
 *   - font-body (Novela) for prose, ink-2 for body text
 *   - max-w-2xl keeps measure comfortable for reading
 */

export const metadata: Metadata = {
  title: "About",
  description:
    "How Restaurants of Reddit turns city subreddits into ranked restaurant reviews: the pipeline, the scoring, and the honest limits.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen flex flex-col">
      {/* Header mirrors the homepage: logo / Request-a-city (desktop only) /
          version stamp. About link is dropped from the right side here
          since we're already on /about. */}
      <header className="px-4 sm:px-8 py-4 sm:py-6 border-b border-rule grid grid-cols-[auto_auto] sm:grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
        <Link href="/" className="justify-self-start">
          <Image
            src="/brand/RoR-logo-no-tagline.svg"
            alt="Restaurants of Reddit"
            width={300}
            height={68}
            priority
            className="h-8 sm:h-10 w-auto"
          />
        </Link>
        <div className="hidden sm:block w-64">
          <CityRequest compact />
        </div>
        <span className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 justify-self-end">
          v0.1 · May 2026
        </span>
      </header>

      <article className="flex-1 px-5 sm:px-8 py-10 sm:py-16 max-w-2xl mx-auto w-full">
        {/* ---- EYEBROW + HEADLINE ------------------------------------- */}
        <div className="font-mono text-mono uppercase tracking-wider text-ink-3 mb-6 flex items-baseline gap-3">
          <span className="text-accent">●</span>
          <span>About</span>
        </div>

        <h1 className="font-display font-medium leading-[0.95] tracking-[-0.02em] text-ink mb-8 text-[40px] sm:text-[56px]">
          How it {" "}
          <em className="text-accent font-display italic">works</em>.
        </h1>

        {/* ---- INTRO -------------------------------------------------- */}
        <section className="mb-12">
          <p className="font-body text-body text-ink-2 mb-5">
            One evening recently, I was sitting around a fire with some
            friends lamenting the fact that Google reviews had become
            absolute shit. You can&rsquo;t trust the star rating because 80%
            of the reviews are complaints about the check taking too long to
            come or the waiter smelling bad or the manager being under 30.
            And the whole point of the stars in the first place is to have a
            quick glance at what the best options are, not sit there sifting
            through all the stupid stuff that has absolutely 0 impact on the
            quality of the food.
          </p>
          <p className="font-body text-body text-ink-2 mb-5">
            Reddit, however, is another story. People on Reddit are coming to
            answer questions in threads, like &ldquo;I&rsquo;m only in Denver
            for 3 months, where should I go?&rdquo; Or, &ldquo;what&rsquo;s a
            hidden gem in Calgary that the locals love?&rdquo; THAT is what
            I&rsquo;m looking for. So that is what I attempted to make here
            with my good friend Claude Code (with inspiration from another
            Reddit review site that I find quite useful:{" "}
            <a
              href="https://redditrecs.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline underline-offset-4"
            >
              redditrecs.com
            </a>
            ).
          </p>
          <p className="font-body text-body text-ink-2">
            Anyway, here&rsquo;s a rundown of how it works for anyone curious.
            If you&rsquo;re smarter than me about this stuff and see room for
            improvement, I am ALL ears cause the manual parts of it are a lil
            tedious (I still have like 200 restaurants in Paris that need to
            be assigned cuisines and/or websites, oops).
          </p>
        </section>

        {/* ---- STEP 1: DISCOVER --------------------------------------- */}
        <SectionHeading step="01" title="Find the threads" />
        <section className="mb-12">
          <p className="font-body text-body text-ink-2 mb-5">
            The pipeline was originally set up to pull Reddit threads from a
            curated list of subreddits per city based on popularity +
            keywords (restaurant, food, etc.). Turns out that plan sucked.
            The juicy food discussions live in threads that aren&rsquo;t
            trending, and I don&rsquo;t have the budget or the patience to
            scrape the entirety of Reddit&rsquo;s database.
          </p>
          <p className="font-body text-body text-ink-2 mb-5">
            So I pivoted to a plain text file per city where I handpicked
            ~25&ndash;70 threads with real, relevant discussions about the
            food in a city and the pipeline read that list instead. Tedious,
            yes, but the signal density per thread was SO much better and
            more cost efficient than letting the scraper roam free.
          </p>
          <p className="font-body text-body text-ink-2">
            Another note: Reddit&rsquo;s official API now gates new clients
            behind a support form approval that apparently takes weeks, so
            this project scrapes via Apify instead. Benefit: longevity (Apify
            can scrape back farther in time). Downside: $$$.
          </p>
        </section>

        {/* ---- STEP 2: RELEVANCE GATE --------------------------------- */}
        <SectionHeading step="02" title="Reduce the noise" />
        <section className="mb-12">
          <p className="font-body text-body text-ink-2 mb-5">
            Since I&rsquo;m trying to find both relevant and abundant threads
            per city (for variety!), some of them weren&rsquo;t perfect. Some
            ended up not even really being about food, despite what the
            OP&rsquo;s post suggested.
          </p>
          <p className="font-body text-body text-ink-2">
            So to filter out the &ldquo;best restaurants that closed during
            COVID, RIP&rdquo; sort of nostalgia or the &ldquo;my favorite
            restaurant is actually a grocery store and so is everyone
            else&rsquo;s on this thread,&rdquo; every thread gets a cheap
            relevance score from Claude Haiku on a 0.0&ndash;1.0 scale before
            extraction. Anything below a 0.4 gets dropped. For the most part,
            it catches the duds I missed and saves the extraction budget for
            the threads that actually have value.
          </p>
        </section>

        {/* ---- STEP 3: EXTRACT ---------------------------------------- */}
        <SectionHeading step="03" title="Get the reviews" />
        <section className="mb-12">
          <p className="font-body text-body text-ink-2 mb-5">
            Every comment in a thread that&rsquo;s deemed relevant goes to
            Claude with a tool-use schema. The output is a list of structured
            evaluations: the restaurant name, an optional neighborhood,
            separate food and service sentiments, a verbatim quote, and vibe
            tags from a closed taxonomy (date_night, hidden_gem,
            special_occasion, etc, depending on the topic of the original
            post).
          </p>
          <p className="font-body text-body text-ink-2 mb-5">
            Food and service sentiments are intentionally kept apart. So
            great food and terrible service produce two separate ratings, not
            an averaged score (the whole impetus of the site, really). A
            restaurant won&rsquo;t lose points if a waitress was rude or
            someone had to wait 45 minutes for a table because the restaurant
            IS POPULAR.
          </p>
          <p className="font-body text-body text-ink-2 mb-5">
            For comments with just the restaurant name, Claude pulls the
            context of the rest of the thread. So if a thread is titled
            &ldquo;Best date night in Denver?&rdquo; and someone just
            responds, &ldquo;Tavernetta,&rdquo; that counts as a positive
            food vote. Neutral search threads (&ldquo;Where can I find sushi?
            Any sushi at all.&rdquo;) are skipped since it&rsquo;s unclear
            whether the sentiment is good or bad.
          </p>
          <p className="font-body text-body text-ink-2">
            For non-English comments, the model returns both the original
            verbatim quote and a literal English translation. For now, this
            only applies to Paris reviews.
          </p>
        </section>

        {/* ---- STEP 4: RESOLVE ---------------------------------------- */}
        <SectionHeading step="04" title="Match it to a real place" />
        <section className="mb-12">
          <p className="font-body text-body text-ink-2 mb-5">
            &ldquo;Sushi Den&rdquo; is a string, so before it can be ranked,
            it needs a stable identity. This stage conducts a Google Places
            text search scoped to the city, picks the best candidate, and
            attaches a confidence score: 0.95 for clean single-result
            matches, 0.80 for top-ranked multi-result matches, down to 0.45
            when several places could plausibly be the one. Anything under a
            0.60 lands in an admin queue for me to go through manually.
          </p>
          <p className="font-body text-body text-ink-2">
            After coming across several mentions of amusement parks and
            malls, I also added a rule to reject Google&rsquo;s non-restaurant
            venue types. I&rsquo;m personally not all that interested in the
            quality of food at Ball Arena.
          </p>
        </section>

        {/* ---- STEP 5: SCORE ------------------------------------------ */}
        <SectionHeading step="05" title="Score and rank" />
        <section className="mb-12">
          <p className="font-body text-body text-ink-2 mb-5">
            Per restaurant, per aspect (food and service), the score is a
            smoothed positive rate:
          </p>
          <pre className="font-mono text-mono bg-paper-2 border border-rule p-4 mb-5 overflow-x-auto">
{`score = (positive + 2.0) / (positive + negative + 2.0 + 1.5)`}
          </pre>
          <p className="font-body text-body text-ink-2 mb-5">
            That&rsquo;s a Beta(&alpha;=2, &beta;=1.5) prior, a slight
            positive lean because Reddit mentions of a restaurant skew toward
            recommendations to begin with. The prior pulls low-volume
            restaurants toward a neutral middle so a single rave doesn&rsquo;t
            crown a place over one with forty mixed reviews. Mixed sentiments
            count as half a positive and half a negative.
          </p>
          <p className="font-body text-body text-ink-2 mb-5">
            City rank is sorted by food score with the total unique commenters
            as the tiebreaker (service score is shown but not taken into
            account when it comes to the ranking). Restaurants whose only
            signal is negative are hidden from the public list.
          </p>
          <p className="font-body text-body text-ink-2">
            Vibe tags are only given to a restaurant when at least two
            different commenters describe it that way, usually in a thread
            that&rsquo;s asking about that specific vibe (ex: apparently
            everyone in Paris goes on their anniversary dinner to
            L&rsquo;Oiseau Blanc, so it&rsquo;s marked with a
            &ldquo;date_night&rdquo; vibe tag).
          </p>
        </section>

        {/* ---- STEP 6: RECONCILIATION --------------------------------- */}
        <SectionHeading step="06" title="Manual reconciliation" />
        <section className="mb-12">
          <p className="font-body text-body text-ink-2">
            Low-confidence matches, ambiguous mentions, and the occasional
            sarcastic thread land in an admin queue. I review them, reassign
            mentions to the right restaurant, assign cuisines that Google
            hadn&rsquo;t labeled, and recompute the city scores when
            I&rsquo;m done (that part, thankfully, is not manual). It&rsquo;s
            a bottleneck but (for now) a necessary quality assurance measure.
          </p>
        </section>

        {/* ---- STACK -------------------------------------------------- */}
        <SectionHeading step="07" title="The stack" />
        <section className="mb-12">
          <ul className="font-body text-body text-ink-2 space-y-3 list-none">
            <li>
              <span className="font-mono text-mono uppercase tracking-wider text-ink-3 mr-3">
                LLMs
              </span>
              Claude Haiku 4.5 for relevance and extraction, via the Anthropic
              SDK with tool-use for structured output.
            </li>
            <li>
              <span className="font-mono text-mono uppercase tracking-wider text-ink-3 mr-3">
                Data
              </span>
              Apify (Reddit scrape) and Google Places (canonical IDs, hours,
              geocoding).
            </li>
            <li>
              <span className="font-mono text-mono uppercase tracking-wider text-ink-3 mr-3">
                App
              </span>
              Next.js 16 App Router, React 19, Tailwind v4, Mapbox GL,
              deployed on Vercel.
            </li>
            <li>
              <span className="font-mono text-mono uppercase tracking-wider text-ink-3 mr-3">
                DB
              </span>
              Supabase &mdash; Postgres with PostGIS for the map.
            </li>
            <li>
              <span className="font-mono text-mono uppercase tracking-wider text-ink-3 mr-3">
                Pipeline
              </span>
              Python, kept as a separate project from the web app and
              writing into the same database.
            </li>
            <li>
              <span className="font-mono text-mono uppercase tracking-wider text-ink-3 mr-3">
                Built with
              </span>
              Claude Code (Opus 4.7) in Cursor.
            </li>
          </ul>
        </section>

        {/* ---- LIMITS ------------------------------------------------- */}
        <SectionHeading step="08" title="Limitations" />
        <section className="mb-12">
          <p className="font-body text-body text-ink-2 mb-5">
            Reddit comes with its own imperfections, of course. Cities with
            small or quiet food subreddits will have fewer mentions and
            noisier rankings. The Bayesian prior helps, but it can&rsquo;t
            invent signal that isn&rsquo;t there.
          </p>
          <p className="font-body text-body text-ink-2 mb-5">
            I&rsquo;ll have to add cities manually over time. Right now,
            it&rsquo;s only four that are relevant to myself and my close
            group of friends. (Note: you can request a city and it&rsquo;ll
            show up on my admin page. If there are more than ~2 or 3
            requests, I&rsquo;ll go ahead and do it.)
          </p>
          <p className="font-body text-body text-ink-2 mb-5">
            I&rsquo;ll refresh the data annually, maybe, assuming this is a
            pet project I still find useful. But a once-a-year refresh
            isn&rsquo;t ideal, so... oh well.
          </p>
          <p className="font-body text-body text-ink-2">
            Bare-name inference can misfire (somewhat frequently, tbh) on
            sarcastic threads. The extractor is conservative about it, but
            we all know LLM models don&rsquo;t understand the subtleties of a
            wink emoji.
          </p>
        </section>

        {/* ---- SIGNOFF ----------------------------------------------- */}
        <p className="font-mono text-mono uppercase tracking-wider text-accent mb-12">
          - Kelsey
        </p>

        {/* ---- BACK LINK --------------------------------------------- */}
        <div className="border-t border-rule pt-8">
          <Link
            href="/"
            className="font-mono text-mono uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
          >
            &larr; Back to the cities
          </Link>
        </div>
      </article>

      {/* Footer mirrors the homepage. */}
      <footer className="px-5 sm:px-8 pt-10 sm:pt-16 pb-6 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 md:items-end">
        <p className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3 text-center md:text-left max-w-sm">
          A field guide to good food.
        </p>
        <p className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3 text-center order-first md:order-none">
          Restaurants of Reddit
        </p>
        <div className="flex md:justify-end justify-center">
          <Image
            src="/brand/RoR-glyph.svg"
            alt="Restaurants of Reddit"
            width={80}
            height={80}
            className="h-12 sm:h-20 w-auto"
          />
        </div>
      </footer>
    </main>
  );
}

/**
 * Small section heading: numbered eyebrow + display title.
 * Step numbers (01, 02, …) read as a field-guide table of contents.
 */
function SectionHeading({ step, title }: { step: string; title: string }) {
  return (
    <div className="mb-5 flex items-baseline gap-4">
      <span className="font-mono text-mono uppercase tracking-wider text-ink-3">
        {step}
      </span>
      <h2 className="font-display text-h3 sm:text-h2 leading-none text-ink">
        {title}
        <span className="text-accent">.</span>
      </h2>
    </div>
  );
}
