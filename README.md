# Bidwise

Bidwise helps SMU students plan their BOSS course bids. For a section and a bidding window it forecasts the bid that is likely to clear, shows the chance that a given bid wins a seat, and plans a set of bids against an e\$ balance. It also browses past results and estimates the chance that a full section gets a seat back, that a swap between two sections works, and that dropping a class and re-bidding for it pays off.

Live site: https://bidwise.pages.dev

Bidwise is not affiliated with SMU. Forecasts are statistical estimates from past results, not guarantees; check the official BOSS rules and your own timetable before you bid.

## Contents

- [Overview](#overview)
  - [What is in this repository](#what-is-in-this-repository)
  - [Tech stack](#tech-stack)
  - [How the pieces connect](#how-the-pieces-connect)
- [The forecast model](#the-forecast-model)
  - [Observations and censoring](#observations-and-censoring)
  - [Demand](#demand-how-many-bid)
  - [Bids](#bids-how-much-each-bidder-offers)
  - [Hierarchical shrinkage and recency](#hierarchical-shrinkage-and-recency)
  - [Time-slot and Friday adjustments](#time-slot-and-friday-adjustments)
  - [From the fit to the seven parameters](#from-the-fit-to-the-seven-parameters)
  - [Simulating the window and the clearing-bid distribution](#simulating-the-window-and-the-clearing-bid-distribution)
  - [Gradient-boosted correction of the price level](#gradient-boosted-correction-of-the-price-level)
  - [Fill chance and range](#fill-chance-and-range)
  - [Bid styles](#bid-styles)
- [Other estimates](#other-estimates)
  - [Drop chance](#drop-chance)
  - [Swap chance](#swap-chance)
  - [Drop and re-bid](#drop-and-re-bid)
  - [Planner](#planner-joint-probability-across-courses)
- [Evaluation](#evaluation)
- [Limitations](#limitations)
- [Running locally](#running-locally)
- [Tests](#tests)

## Overview

### What is in this repository

```
site/                 Astro + Svelte website (static build)
  src/pages/            pages: home, course, planner, explore (Browse and chart builder), schedule, method, contact
  src/components/       Svelte components and their pure helper modules, with vitest tests
  src/lib/sim/          bid simulator, bid styles (presets.ts), planner optimiser, web worker, result cache
  src/lib/swap/         swap-chance model
  src/lib/snipe/        drop-and-re-bid helpers
  src/lib/data/         readers for the generated JSON, seat and window helpers, accuracy figures
model/
  forecast/fit.py       fits the forecast parameters per section and window; backtests; writes JSON
  forecast/sim.py       Python port of the site's simulator (same random number generator)
  forecast/correction.py  gradient-boosted correction of the fitted price level
  forecast/distcal.py   gradient-boosted fill chance and range calibration; bid levels per window group; measured win rates
  forecast/evalharness.py  rolling no-look-ahead evaluation of the bid styles (writes only to a private folder)
  forecast/evalscore.py    scoring for the harness: win rate, overpay, bootstrap intervals
  forecast/promisecal.py   conformal alternative for the bid styles, evaluated only, not shipped
  forecast/drops.py     drop chance
  build_site_data.py    turns a bid-results table plus the fit output into the JSON the site reads
  exams.py              reads final-exam dates into the site data
  site_window.json      current term, current window and the window schedule
tests/                  Python tests for fit, simulator and site-data build, with synthetic fixtures
docs/                   model-plain.md (plain language) and model-technical.md (technical write-up)
```

Not in the repository: the bid-results data, the fitted parameter files, the generated site data (`site/src/data/real/`) and any data-gathering code. The model is trained on historical BOSS bid results, and that dataset is not published.

### Tech stack

**Site** (`site/package.json`):
- Astro 5 with `output: 'static'`, so the site is built to plain files and hosted on Cloudflare Pages. Interactive parts are Svelte 5 components.
- Observable Plot draws the charts.
- vitest runs the TypeScript unit tests.
- TypeScript, checked with `astro check`.

**Model:**
- Python 3.12. The fit (`fit.py`), the simulator (`sim.py`), the drop chance (`drops.py`) and the site-data build (`build_site_data.py`) use only the standard library.
- The correction (`correction.py`) and the fill chance and range calibration (`distcal.py`) additionally need numpy, pandas and scikit-learn (developed with numpy 2.5.4, pandas 3.1.1, scikit-learn 1.9.1). Both are optional: if the imports fail or any check fails, the build keeps the previous stage (the plain fit, or the corrected fit).

### How the pieces connect

1. `python -m model.forecast.fit` reads a bid-results CSV and writes, for every section of the current term and every bidding window, seven simulator parameters (`demandMean`, `demandDispersion`, `priceLevelCents`, `priceSigma`, `anchorSigma`, `anchorShare`, `anchorCents`), plus a backtest report, to `model/forecast/out/`.
2. `python model/build_site_data.py --csv <bids_with_schedule.csv>` reads the same CSV, `site_window.json` and the fit output.
   - It optionally applies the correction and then the fill chance and range calibration (three more parameters per section and window: `fillProb`, `spreadLo`, `spreadHi`), then writes JSON to `site/src/data/real/`: `meta.json`, `index.json`, `browse.json` and per-term shards, `courses/<CODE>.json` (history, current sections, per-window forecast parameters, drop chance, exam dates), `forecast-meta.json`, `accuracy.json` and `highlights.json`.
   - The accuracy figures on the site come from the backtest files, not from typed-in numbers.
3. `npm run build` bakes those files into the static pages.
4. In the browser, the forecast is not precomputed.
   - The page takes the seven parameters of the chosen section and window and replays the window 20,000 times (`FORECAST_RUNS`, seed 12345 in `site/src/lib/sim/forecast.ts`).
   - The replay runs in a module Web Worker (`site/src/lib/sim/worker.ts`, started from `client.ts`, with an inline fallback when workers are unavailable), and results are memoised per input (`cache.ts`). The same worker runs the planner optimiser.
   - There are two simulators: Python (`model/forecast/sim.py`) for backtests and data, and TypeScript (`site/src/lib/sim/index.ts`) in the browser. `tests/fixtures/forecast_sim_parity.json` (generated by running the TypeScript with `tests/fixtures/forecast_sim_parity_gen.ts`) is the parity test that keeps them in step.

## The forecast model

Notation used throughout: $`S`$ seats offered in the window, $`N`$ number of bidders, $`\lambda = E[N]`$, $`r`$ dispersion of the bidder count, $`m`$ median bid level in cents, $`\sigma`$ bid spread, $`q`$ anchor share, $`F`$ the minimum bid in cents (the floor). Amounts are in cents in the code (e\$1 = 100 cents).

The facts about BOSS that the model relies on:

- Bidding is blind.
- Winners pay their own bid.
- The highest bids win.
- Ties at the cutoff are broken randomly.
- If a section does not fill every bid at or above the minimum succeeds.

For each section and bidding window a forecast is made in this order:

| Step | What it does | Code | Since |
|---|---|---|---|
| 1. Fit | Past terms give the number of students who will bid and how high they bid, per course, instructor and window, with recent terms counting more. A section with little history borrows from its course, then its subject, then all courses. | `fit.py` | before 9 Nov 2026 |
| 2. Replay | The window is simulated 20,000 times. If fewer students bid than there are seats the section does not fill and a minimum bid (usually e\$10) wins; otherwise the clearing bid is the lowest winning bid. BOSS is pay-as-bid: a winner pays their own bid, not the clearing bid. | `sim.py`, and its TypeScript twin in the browser | |
| 3. Price correction | A gradient-boosted model trained on earlier terms moves each section's price level, using its history and this term's earlier rounds. | `correction.py` | 9 Nov 2026 |
| 4. Fill chance and range | A second gradient-boosted model sets the chance that the section fills, and the spread of the replayed clearing bids is narrowed or widened by factors learned from past terms. | `distcal.py` | 15 Nov 2026 |
| 5. Bid styles | Cheap, Balanced and Safe are three points on the replayed distribution of clearing bids. How far up it each one sits is set per window group, so that each wins its target share of sections that fill. | `distcal.py` levels, applied in `presets.ts` | |

Chance of a seat, recommended bid, groups, planner and drop and re-bid all read these parameters and run the simulator. Each window from the current one onward is forecast; past windows of the term keep their plain fitted parameters.

### Observations and censoring

One observation is one row of BOSS Overall Results: a section in one bidding window of one term.

- The seats offered $`S`$ are the vacancy before the window was processed.
- The number of successful bids is $`B = S - \text{vacancy after}`$.
- A section is filled when the vacancy after processing is 0.
- The results give the minimum and the median of the successful bids, which are the $`S`$-th and the $`\tfrac{S+1}{2}`$-th highest bids.

Two consequences shape the likelihoods:

- If the section did not fill, every bidder succeeded, so $`N = B`$ exactly, and the clearing bid is the floor $`F`$.
- If it filled, only $`N \ge S`$ is known (right-censored), and the clearing bid is the minimum successful bid.

**Floor.** The floor is 1000 cents unless a course's lowest observed minimum is 1100 to 2000 cents and at least 3 rows sit within a cent of it.

**Data used.** Only Term 1 and Term 2 are used, windows are matched on BOSS's exact label (so each window has its own parameters), and rows from the target term or later are never used for training.

In code: `Obs`, `build_obs`, `course_floors`, `censored_demand` and `actual_cutoff` in `model/forecast/fit.py`.

### Demand: how many bid

The number of bidders is negative binomial, which allows a busy section to be much busier than average:

```math
N \sim \mathrm{NegBin}(\lambda, r), \qquad \Pr(N = c) = \frac{\Gamma(c + r)}{\Gamma(r)\, c!} \left(\frac{r}{r + \lambda}\right)^{r} \left(\frac{\lambda}{r + \lambda}\right)^{c}, \qquad \mathrm{Var}(N) = \lambda + \frac{\lambda^2}{r}
```

The dispersion $`r`$ is one global constant, chosen in calibration (0.4 at the last fit).

Each observation $`o`$ contributes a log-likelihood term to $`\log\lambda`$, weighted by $`w_o`$ (recency weight, below):

```math
\ell_o(\lambda) = w_o \cdot \begin{cases} \log \Pr(N = B_o \mid \lambda_o) & \text{section did not fill} \\ \log \Pr(N \ge S_o \mid \lambda_o) = \log\Big(1 - \sum_{j < S_o} \Pr(N = j \mid \lambda_o)\Big) & \text{section filled} \end{cases}
```

where $`\lambda_o = \lambda\, e^{\beta^d}`$ and $`\beta^d`$ is the time-slot effect (below). A filled section therefore says "at least $`S`$ bidders" and pushes the estimate up; an unfilled one pins the count exactly.

The posterior of $`x = \log\lambda`$ is computed on a grid $`x_j = \ln 0.02 + 0.1\,j`$ for $`j = 0, \dots, 107`$:

```math
p(x_j) \propto \exp\Big(\sum_{o} \ell_o(e^{x_j}) - \frac{(x_j - \mu)^2}{2\tau^2}\Big)
```

The Gaussian prior has mean $`\mu`$ and standard deviation $`\tau`$ taken from the hierarchy (below). The grid posterior returns $`E[x]`$, $`\mathrm{sd}(x)`$ and $`E[e^x]`$.

In code: `NBTables.logpmf` and `NBTables.logsf` (the pmf and the survival term, floored at $`10^{-300}`$), `grid_posterior`, and `Model.dpost` in `model/forecast/fit.py`. `dpost` applies the slot effect by shifting the grid index by $`\mathrm{round}(\beta^d / 0.1)`$ for each observation, so the likelihood of an early or late section is evaluated at its own scale and the posterior stays on the mid-slot scale.

### Bids: how much each bidder offers

Each of the $`N`$ bidders is, independently, either anchored or not:

- With probability $`q`$ the bid is $`F + 200\,U`$ cents with $`U \sim \mathrm{Unif}(0,1)`$: the minimum or just above it.
- Otherwise the bid is $`M e^{\sigma Z}`$ with $`Z \sim N(0,1)`$. The level $`M = m\, e^{s_M Z_M}`$, $`Z_M \sim N(0,1)`$, is drawn once per replay, so the whole window's price level moves together.

Bids are rounded to whole cents and raised to $`F`$ if below it. The clearing bid is the $`S`$-th highest bid.

**Order-statistic scores.** To fit $`m`$ from a filled section's observed clearing bid, the model needs where the $`S`$-th highest of $`n_s`$ lognormal bids is expected to sit. Let $`\bar\lambda_c`$ be the course-level posterior mean of $`\lambda`$ for that window, $`\hat N = \max\big(S,\, E[N \mid N \ge S]\big)`$ the expected number of bidders given that the section filled, and $`n_s = (1 - q)\hat N`$ the non-anchored ones. The expected normal score of the $`k`$-th highest (Blom's approximation) is

```math
z(k) = \Phi^{-1}\Big(\mathrm{clip}_{[0.02,\,0.98]} \frac{n_s - k + 0.625}{n_s + 0.25}\Big), \qquad z_S = z(S), \qquad z_{\mathrm{med}} = z\Big(\frac{S+1}{2}\Big)
```

so that $`\ln(\text{clearing bid}) \approx \ln m + \sigma z_S`$.

**Spread $`\sigma_w`$ (one per window).** The median successful bid is the $`\frac{S+1}{2}`$-th highest and the minimum is the $`S`$-th, so $`\ln(\mathrm{med}/\mathrm{min}) \approx \sigma (z_{\mathrm{med}} - z_S)`$. Over filled sections with $`\mathrm{min} > F + 200`$ and $`\mathrm{med} > \mathrm{min}`$:

```math
\hat\sigma_w = \mathrm{clip}_{[0.15,\,0.9]} \frac{\sum_o w_o \ln(\mathrm{med}_o / \mathrm{min}_o)}{\sum_o w_o (z_{\mathrm{med},o} - z_{S,o})}
```

with $`\hat\sigma_w = 0.4`$ when the denominator is 3 or less.

**Anchor share $`q_w`$ (one per window).** Among sections that did not fill, had $`B \ge 3`$ and a positive median, let $`f`$ be the weighted share whose median bid is within $`F + 200`$. If each of $`B`$ bids is anchored with probability $`q`$, the median sits in the anchor band when at least half are anchored. With $`g(q)`$ the weighted mean over those sections of $`\Pr[\mathrm{Bin}(B, q) \ge \lfloor (B+1)/2 \rfloor]`$:

```math
q_w = \arg\min_{q \in \lbrace 0,\, 0.05,\, \dots,\, 0.9 \rbrace} \lvert g(q) - f \rvert
```

with $`q_w = 0.3`$ when fewer than 30 such sections exist.

**Price level $`x = \ln m`$.** Only filled sections inform it. With the clearing bid $`\mathrm{min}_o`$ of section $`o`$:

```math
y_o = \ln \mathrm{min}_o - \sigma_w z_{S,o} - \beta^p \sim N(x, s^2) \quad \text{if } \mathrm{min}_o > F + 200
```

- If $`\mathrm{min}_o \le F + 200`$ the clearing bid is hidden inside the anchor band, so the term is left-censored: $`w_o \log \Phi\big((y^c_o - x)/s\big)`$ with $`y^c_o = \ln(F + 200) - \sigma_w z_{S,o} - \beta^p`$.
- The residual standard deviation $`s`$ is the pooled within (course, instructor, window) standard deviation of $`\ln \mathrm{min}_o - \sigma_w z_{S,o}`$, floored at 0.2 (0.4 when there are 10 or fewer degrees of freedom).
- The posterior over $`x`$ uses the same grid method as demand, on $`x_j = \ln 500 + 0.05\,j`$ for $`j = 0, \dots, 89`$.

In code: `Model._fit_price_globals` (fits $`q_w`$, $`\sigma_w`$ and $`s`$), `Model._nhat_z_raw` (the scores $`z_S`$, $`z_{\mathrm{med}}`$, using `nb_tail_mean` for $`E[N \mid N \ge S]`$), `binom_ge`, `Model._y`, and `Model.ppost` (the Tobit posterior) in `model/forecast/fit.py`.

### Hierarchical shrinkage and recency

A professor with one past result should not get an extreme estimate. Every observation is added to four nested groups inside its window: all courses ($`g`$), subject ($`s`$), course ($`c`$) and course by instructor ($`ci`$). Each group's posterior is the grid posterior above, with a Gaussian prior centred on its parent's posterior mean:

```math
\mu_{\text{group}} = E[x \mid \text{parent}], \qquad \mu_g = \ln 5 \ \text{(demand)}, \quad \mu_g = \ln 2000 \ \text{(price)}
```

| Level | $`\tau`$ for $`\log\lambda`$ | $`\tau`$ for $`\log m`$ |
|---|---|---|
| all courses | 3.0 | 3.0 |
| subject | 1.0 | 0.5 |
| course | 0.9 | 0.4 |
| course by instructor | 0.7 | 0.3 |

- A group with no observations returns its prior, so a new instructor inherits the course, a new course inherits its subject, and so on.
- A small $`\tau`$ keeps a group close to its parent.
- With $`n`$ weighted observations the data's pull behaves roughly like $`n / (n + \kappa)`$.

**Recency and term type.** For a target term with index $`t^*`$ and an observation from term index $`t_o`$ (index $`= 2 \cdot \text{start year} + \text{term number} - 1`$):

```math
w_o = \delta^{(t^* - t_o)/2} \cdot \begin{cases} 1 & \text{same term type} \\ c_w & \text{other term type} \end{cases}, \qquad \delta = 0.7 \text{ per year}, \quad c_w = 0.5
```

The weights multiply each observation's log-likelihood, as fractional counts. Observations with $`w_o \le 0.001`$ are dropped.

**Caveat.** The hierarchy is not a strict Bayesian one: a child's prior mean is its parent's posterior, which already contains the child's data, so the child's data is counted at both levels.

In code: `Model.__init__` (weights and the four-level `groups`), `Model.key` and `Model.parent` (the hierarchy), `obs_weight`, `pool_weight` (the $`n/(n+\kappa)`$ form), and `Config` (the $`\tau`$ values, `decay`, `cross_w`) in `model/forecast/fit.py`.

### Time-slot and Friday adjustments

A section's start time is bucketed from its first meeting: `early` if it starts at or before 08:30, `late` if at or after 18:00, `mid` otherwise, plus `_fri` when the first listed day is Friday. That gives six keys: `early`, `mid`, `late`, `early_fri`, `mid_fri`, `late_fri`.

Within each (term, window, course) cell that has a mid section, every non-mid section is compared with the cell's mid sections:

- Demand contrast: $`\Delta^d = \ln(1 + L/S) - \overline{\ln(1 + L_i/S_i)}_{i \in \mathrm{mid}}`$, where $`L = S`$ if the section filled and $`L = B`$ otherwise (a lower bound for $`N`$).
- Price contrast, for filled sections: $`\Delta^p = \ln \mathrm{min} - \overline{\ln \mathrm{min}_i}_{i \in \mathrm{mid},\ \text{filled}}`$.

For a slot key with $`n_k`$ contrasts:

```math
\beta^d_k = \mathrm{round}_{0.1}\Big(2 \cdot \overline{\Delta^d} \cdot \frac{n_k}{n_k + 30}\Big), \qquad \beta^p_k = \overline{\Delta^p} \cdot \frac{n_k}{n_k + 30}
```

- The factor 2 compensates for the demand proxy being compressed relative to $`\log\lambda`$.
- Effects are estimated once over all training rows and again per window; a window uses its own value for a key when it has at least 30 contrasts for it, otherwise the pooled value.
- In fitting, each observation is moved to the mid scale (the shift in the demand likelihood, and $`\beta^p`$ subtracted from $`y_o`$); at prediction the section's own effect is added back.

Calibration keeps the slot effects on unless same-course ordering accuracy drops by more than 2 points or the Brier score worsens by more than 0.0002 (`calibrate`).

In code: `slot_of`, `slot_key`, `_slot_contrasts`, `estimate_slot_effects`, `estimate_slot_effects_by_window` in `model/forecast/fit.py`; `Model._beta_d`, `Model._beta_p` and `Model._shift` apply them.

### From the fit to the seven parameters

For a section of course $`c`$ taught by instructor $`i`$ in window $`w`$ with slot effects $`\beta^d, \beta^p`$ and floor $`F`$, using the course-by-instructor posteriors:

```math
\lambda = E[e^{x} \mid ci]\, e^{\beta^d}, \qquad m = \max\Big(F,\ e^{E[\ln m \mid ci] + \beta^p}\, c_{\text{scale}}\Big)
```

```math
r = r_{\text{global}}, \qquad \sigma = \hat\sigma_w, \qquad q = q_w, \qquad s_M = \sqrt{\ell_{sd}^2 + \mathrm{sd}(\ln m \mid ci)^2}, \qquad \text{anchor price} = F
```

- Demand uses the posterior mean on the natural scale; the price uses the posterior mean on the log scale (a median).
- $`c_{\text{scale}}`$ is a global price multiplier and $`\ell_{sd}`$ the term-to-term drift of the price level; both are set in calibration (1.380 and 0.1 at the last fit, 17 Nov 2026).

In code: `Model.params_for` returns a `SimParams` (`model/forecast/sim.py`) and records which level supplied the estimate (`pooledLevel`). `make_params_json` writes it for every current-term section and window.

### Simulating the window and the clearing-bid distribution

Given seats $`S`$, a group of $`g`$ friends who all bid the same amount, the floor $`F`$ and the seven parameters, each replay does the following with $`k = S - g + 1`$:

1. Draw $`N \sim \mathrm{NegBin}(\lambda, r)`$, sampled as $`\mathrm{Poisson}(G \lambda / r)`$ with $`G \sim \mathrm{Gamma}(r, 1)`$.
2. If $`N < k`$ the seats are not contested and the cutoff is $`F`$. The replay counts as filled only if $`N \ge k`$.
3. Otherwise draw the level shock $`M`$, draw $`N`$ bids as above, round and floor them, and take the cutoff as the $`k`$-th highest bid.

So a section with $`S`$ seats clears at the $`S`$-th highest bid among the other bidders, and at the minimum when fewer than $`S`$ bid. A group of $`g`$ all bidding $`b`$ all get in exactly when fewer than $`k`$ other bidders bid more than $`b`$.

After $`R`$ replays, with cutoffs $`C_1, \dots, C_R`$:

```math
\hat P_{\text{fill}} = \frac{\#\lbrace \text{replays with } N \ge k \rbrace}{R}, \qquad \mathrm{pIn}(b) = \frac{\#\lbrace C_i < b \rbrace + \tfrac{1}{2} \#\lbrace C_i = b \rbrace}{R}
```

The cutoff distribution (median, 90th percentile and so on) is read from the sorted cutoffs.

$`\mathrm{pIn}`$ is the chance that a bid of $`b`$ gets a seat; a bid equal to a replay's cutoff wins by random draw, as BOSS breaks ties randomly: with $`A`$ rivals bidding more and $`T`$ tied at the cutoff, a group of $`g`$ wins with probability $`\binom{S-A}{g} / \binom{T+g}{g}`$ (one bidder: $`(S-A)/(T+1)`$), and a floor bid wins for certain when seats are left over. It is evaluated on up to 120 grid points from $`F`$ to $`\max(F + 100,\ \lceil 1.15\, p_{99} \rceil)`$ and linearly interpolated.

The recommended bid for a chance level (the bid styles use the levels in [Bid styles](#bid-styles); without calibration 80, 90 or 95%) is the smallest odd-cent bid with $`\mathrm{pIn}(b) \ge`$ target; odd cents avoid ties with round-number bids.

In code: `simulate`, `sample_cutoffs`, `Rng.neg_bin`, `p_in_at` and `recommend_bid` in `model/forecast/sim.py`, and the same functions (`simulate`, `pInAt`, `recommendBid`) in `site/src/lib/sim/index.ts`, which is what runs in the browser. The fit's backtest calls `sample_cutoffs` through `_sim_one` in `fit.py`.

### Gradient-boosted correction of the price level

The fitted price level is pulled toward the course and subject by the shrinkage and is biased low for hot sections. A gradient-boosted model predicts the clearing bid directly from richer history, and the simulator's price level is rescaled so that its own median lands on that prediction. The correction leaves demand, the spread and $`\hat P_{\text{fill}}`$ alone; the next section changes those two.

**Target.** For filled sections, $`\ln a`$, where $`a`$ is the actual clearing bid. The model is scikit-learn's `HistGradientBoostingRegressor` with quantile loss at 0.5 (a median regression), learning rate 0.03, at most 24 leaves, at least 20 samples per leaf, L2 regularisation 1.0, early stopping on a 15% validation split. The prediction is the mean of three fits with seeds 0, 1 and 2:

```math
\hat g = \frac{1}{3} \sum_{\text{seed}=0}^{2} \exp\big(f_{\text{seed}}(x)\big)
```

**Features** (83 columns). Every feature of a row uses only terms before that row's term, plus results of strictly earlier windows of its own term, so nothing from the target outcome leaks in.

- History aggregates are recency-weighted with the same $`\delta`$ and $`c_w`$ as the fit, over eight groupings (course by instructor by window, course by window, subject by window, window, course by instructor, course, instructor, subject): weighted count and weight sum, fill rate, mean log clearing bid (over all rows and over filled rows), mean log seats, mean log of successful bids, and for the two most specific groupings the latest earlier filled clearing bid and how many terms ago it was.
- Within-term features describe the same section's earlier windows (how many, whether it filled, seats and successes, last filled clearing bid and the gap) and the same course's other sections in earlier windows.
- The rest are window index and round group, seats offered, log seats, log capacity, the seats-to-capacity ratio, term type, a flag for a course-instructor pair never seen before, and the slot key and subject as categorical features.

Training uses terms from 2023-24 Term 1 onward.

**Level factor.** A single factor $`f`$ calibrates the overall level from the previous (up to) two terms, using each term's out-of-sample prediction (each trained only on terms before it):

```math
f = \frac{\sum a}{\sum \hat g} \quad \text{over filled sections of the previous two terms}
```

**Application.** For each current-term section and each window from the current one onward, with $`b_{50}`$ the median of the simulated cutoffs among replays that filled:

```math
\text{scale} = \frac{f\, \hat g}{b_{50}}, \qquad m_{\text{corrected}} = m \cdot \text{scale}
```

- Rows with no simulated fill have no level to move and are left alone.
- A row whose scale is non-finite or outside 0.1 to 10 keeps its fitted price.

**Gate.** The correction is dropped entirely, and the site ships the plain fit, if any of these hold:

- $`f`$ is outside 0.5 to 2
- more than 10% of rows are skipped
- more than 5% of rows have a scale outside 0.3 to 3 (rows outside 0.3 to 3 but inside 0.1 to 10 are still rescaled, because skipping them cost accuracy on hot sections, but they count toward this limit)
- numpy, pandas or scikit-learn cannot be imported
- the corrected backtest file is missing, stale or failed its own gate

The corrected backtest must pass the fit's coverage check and beat the baseline's average miss (see Evaluation), must be for the same terms and fit configuration, and must have been made with the same GBM hyperparameters (`corrected_backtest_usable`).

`CORRECTION_ENABLED` in `build_site_data.py`, the environment variable `BIDWISE_CORRECTION=0` and `--no-correction` switch it off.

In code: `model/forecast/correction.py`. `obs_frame`, `_hist_feats`, `_within_feats` and `features_for` build the features; `train_predict` fits and predicts; `level_factor` computes $`f`$; `rescale_scales` computes the scale per row; `gate_check` applies the gate; `apply_scales` multiplies `priceLevelCents` (keeping the original as `priceLevelCentsBase`); `apply_correction` and `try_apply_correction` run the whole thing (the latter never raises); `backtest_corrected` and `build_corrected_backtest` score it. `maybe_correct` in `model/build_site_data.py` is the caller.

### Fill chance and range

Two pieces on top of the corrected forecast (`model/forecast/distcal.py`, since 15 Nov 2026). They use the same features and hyperparameters as the correction, so they see this term's earlier rounds.

- **Fill chance.** A gradient-boosted classifier (`HistGradientBoostingClassifier`, seeds 0, 1 and 2 averaged), trained on every section with seats from terms before the target term, gives the chance that the section fills. It replaces $`\hat P_{\text{fill}}`$ from the replays (`fillProb`).
- **Range.** The replayed clearing bids that filled were too wide around their median $`m`$. Each is moved to $`\max(F,\ m\,(c/m)^{s})`$, with an exponent $`s`$ above the median and another below it, learned per cell (forecast level in five bands, times one seat or several) by minimising quantile loss at the 10% and 90% points against real clearing bids (`spreadLo`, `spreadHi`).

**Gate.** At each refit the pair is kept only if:

- the classifier's Brier score (the mean squared error of the fill chance; lower is better) beats the replays' on both the test term (2025-26 Term 2) and the held-out term (2026-27 Term 1, which the fit, the correction and the classifier never saw; the shipped range exponents and the bid levels are learned on it too, so only the classifier and the gate's own scoring are clean on that term, see [Bid styles](#bid-styles))
- the 80% range on the held-out term covers 75 to 85% of its filled sections
- the mean pinball loss at the 50, 80, 90 and 95% points beats the uncalibrated one.

Otherwise, or if anything else fails, the site ships the corrected forecast without either piece, for all sections.

In code: `learn_spread`, `apply`, `backtest_distcal` and `gate` in `model/forecast/distcal.py`; `maybe_calibrate` in `model/build_site_data.py`; the browser applies the same transform in `site/src/lib/sim/index.ts`.

### Bid styles

A suggested bid is a point on the replayed distribution of clearing bids, with replays that did not fill counted as clearing at the minimum. At level $`\ell`$ it is the $`\ell`$ quantile of the mixture: probability $`1 - \hat P_{\text{fill}}`$ at $`F`$, and $`\hat P_{\text{fill}}`$ spread over the clearing bids of the replays that filled (`_uq` in `distcal.py`).

Since 17 Nov 2026 (`distcal-a2`) each style targets a win rate on sections that fill: Cheap 70%, Balanced 85% (the default), Safe 90% (`CHEAP_LOSS`, `BALANCED_LOSS`, `SAFE_LOSS` = 0.30, 0.15, 0.10).

**Rounding.** A raw bid is raised to the next odd cent. At the minimum it stays there; above it, it goes up to the next whole e\$ plus one cent, because about 3 in 10 real clearing bids are whole e\$ amounts (`site_round`).

**Choosing a level.** For each level on `LEVEL_GRID` (0.300 to 0.995 in steps of 0.005), every backtest row gets an unrounded bid (the measured win rates below use rounded bids), and `lossFilled` is the share of filled rows whose real clearing bid was above it. A style's level is the lowest one with `lossFilled` at or under its limit (`pick_levels`). If none qualifies, the top of the grid is used and flagged `reached: false`.

**Per window group.** Levels are picked separately for each window group (`GROUPS`, from `evalscore.window_group`):

| Group | Windows |
|---|---|
| R1W1 | Round 1 Window 1 |
| R1A | Round 1A Windows 1 to 3 |
| R1B | Round 1B Windows 1 and 2 |
| R2 | Round 2 Windows 1 to 3 |
| R2A | Round 2A Windows 1 to 3 |

- The rows are those of the test and held-out terms.
- Each term is scored with the range exponents learned on the other term (cross-fit, `calibrate_levels`).
- A group with fewer than 100 filled rows (`MIN_CELL`) uses the pooled level.
- Rounds differ (Round 1A sits lowest, Rounds 2 and 2A highest), which is why one global level under-delivered in the later rounds.

Levels of the 17 Nov 2026 refit:

| Group | Cheap | Balanced | Safe |
|---|---|---|---|
| Pooled (fallback) | 0.880 | 0.965 | 0.985 |
| R1W1 | 0.865 | 0.940 | 0.970 |
| R1A | 0.800 | 0.925 | 0.965 |
| R1B | 0.875 | 0.965 | 0.985 |
| R2 | 0.935 | 0.985 | 0.995 |
| R2A | 0.990 | 0.995 (not reached) | 0.995 (not reached) |

**Measured win rate.** `measured_win` estimates each style's out-of-sample win rate on filled sections. Levels picked on one term are applied to the other, in both directions, and the two folds are pooled. Which groups get their own level is decided once over both terms (`own_groups`), the same rule as the shipped pick, so each group is measured at the kind of level it ships with (since 17 Nov 2026; before, each fold applied the 100-row test to one term, and Round 2A was measured at the pooled level). Rates are kept per window group and forecast band. The band is the conditional median: under e\$15, 15 to 25, 25 to 40, 40 to 60, or 60 and over (`BAND_EDGES`). A cell with fewer than 100 filled rows falls back to its group's rate, and a group without that many falls back to the overall rate.

**On the site.** `window_bid_fields` and `measured_summary` in `build_site_data.py` copy these into `forecast-meta.json` as `bidLevelsByWindow`, `measuredWin`, `bandEdges` and `measuredWinSummary`.

- `suggestBid` in `site/src/lib/sim/presets.ts` uses the window's level. Without one it falls back to the pooled `bidLevels`, and without calibration to 80, 90 and 95%.
- The course page shows the measured rate for the section's group and band next to each style ("if it fills"). It adds a note when the rate is more than 6 points under the target (`MEASURED_TOLERANCE` in `site/src/lib/sim/windowBids.ts`). Styles that give the same rounded bid share the lowest of their rates.
- The headline chance of a seat still comes from the replays.
- A `distcal-a1` file, which has pooled levels only, is still accepted.

## Other estimates

### Drop chance

For a section that is full now: the chance that seats are offered again by each later window of the same term. A seat dropped in a window opens in that window and can be taken in the same window, so it counts from the first window that offers it.

- A case is one class in one past term that was full in the base window $`w_0`$.
- While a window is open, full means it started the window full (vacancy before processing is 0); between windows, it means the previous window ended full. The two behave differently and are never mixed.
- For each later window $`k`$, a case counts as a success if any window after $`w_0`$ and up to $`k`$ offered seats again (vacancy before processing above 0).
- A case that never saw window $`k`$ and had no seat before it is unknown and dropped.
- The current term is excluded.

Counts are made at three levels (all courses, subject, course), with $`n`$ cases and $`x`$ successes at each. Rates are shrunk toward the parent with $`K = 5`$ pseudo-cases:

```math
\hat p_g = \frac{x_g}{n_g}, \qquad \hat p_s = \frac{x_s + K \hat p_g}{n_s + K}, \qquad \hat p_c = \frac{x_c + K \hat p_s}{n_c + K}
```

A course with no cases gets its subject's rate. The chance shown for window $`k`$ is made non-decreasing across later windows:

```math
P_k = \max_{j \le k} \hat p_c(j)
```

The reported sample size is the case count at the narrowest level with at least 5 cases (course, then subject, then all). It counts (class, term) cases, not independent events, so it overstates the evidence.

In code: `collect_counts`, `estimate` and `drop_chances` in `model/forecast/drops.py`; `drop_windows` and `attach_drops` in `model/build_site_data.py` choose the base window and the later windows from the current window and the schedule in `site_window.json`.

### Swap chance

A holder of section A asks how likely a swap into section B of the same course is. Nothing here is fitted to swap outcomes, because SMU publishes none.

**Desirability.** On the Round 1 Window 1 forecast, with $`p_{50}`$ the simulated median clearing bid for a group of 1 at the section's full seat count (4,000 runs), $`\lambda_s`$ the fitted demand and $`S_s`$ the seats:

```math
v_s = \ln p_{50,s} + 0.25 \ln \frac{\lambda_s}{S_s}, \qquad d_s = v_s - \mathrm{median}_s(v)
```

- The second term breaks ties between sections that all clear at the minimum bid.
- In a pre-assigned course (the median share of seats offered in Round 1 Window 1 is under 0.25 over at least 3 historical rows), almost every seat is given out before bidding and the simulator would give every section the minimum, so $`v_s = \ln(\text{price level})`$ from the same window's forecast, with no simulation.
- A section with no usable forecast falls back to last term's clearing bids relative to the course median.

**Holders and requests.** The number of holders is the seat count $`n`$ (in a pre-assigned course, $`n`$ minus the typical seats offered in bidding, at least 1). Each holder of A applies for B with probability

```math
p(A \to B) = r\, \sigma_{\text{logistic}}\big(k\,(d_B - d_A)\big), \qquad r = 0.1, \quad k = 5.5
```

where $`\sigma_{\text{logistic}}(x) = 1/(1 + e^{-x})`$.

**Direct-pair chance.** Let $`X \sim \mathrm{Bin}(n_A - 1,\, p_{AB})`$ be the other holders of A who apply for B and $`Y \sim \mathrm{Bin}(n_B,\, p_{BA})`$ the holders of B who apply for A. Up to $`\min(1 + X, Y)`$ swaps can happen and the applicants from A share them equally:

```math
P(\text{swap}) = E\left[\frac{\min(1 + X,\ Y)}{1 + X}\right] = \sum_{x} \Pr(X = x)\, \frac{1}{x + 1} \sum_{j=1}^{\min(x + 1,\ n_B)} \Pr(Y \ge j)
```

using $`E[\min(m, Y)] = \sum_{j=1}^{m} \Pr(Y \ge j)`$, which makes the computation exact and linear in the section sizes.

- Cycles through three or more sections are ignored.
- The range shown is the min and max of the chance at $`(r, k) = (0.1, 5.5)`$ and at the four corners $`r \in \lbrace r/1.5,\ 1.5r \rbrace`$, $`k \in \lbrace k/1.25,\ 1.25k \rbrace`$.
- The label comes from the central chance: likely at 0.75 or more, unlikely below 0.4, otherwise possible.

$`r`$ and $`k`$ are judgment settings, chosen so the central chance is about 60 to 70% for equally wanted sections, 80 to 90% when the other section is less wanted, 20 to 40% when it is more wanted and under 15% when it is much more wanted (checked in `swap.test.ts` for two sections of 45 seats).

In code: `requestProb`, `swapChance` (the sum above, with `binomPmf`), `swapResult` (centre and band), `labelFor`, `rawDesirability`, `desirabilities` (centring, pre-assigned path, fallback), `isPreAssigned`, `holdersIn` and `swapOptions` in `site/src/lib/swap/swap.ts`. `swapBidCents` in `site/src/lib/swap/swapSim.ts` runs the 4,000-run simulation for $`p_{50}`$.

### Drop and re-bid

A student who won a section with a high bid drops it in a later window, gets a refund capped by round, and bids again near the minimum, hoping nobody else takes the freed seat.

The refund cap in e\$ is 50 in Rounds 1 and 1A, 40 in 1B, 30 in 2 and 10 in 2A.

With $`\text{paid}`$ the original bid and $`b`$ the re-bid:

```math
\text{refund} = \min(\text{paid},\, \text{cap}), \qquad \text{net cost if it works} = \text{paid} - \text{refund} + b, \qquad \text{saving} = \text{refund} - b
```

The chance that the re-bid wins is the chance that a bid of $`b`$ takes one seat for one bidder in the chosen window, from the same simulator and forecast as the course page:

```math
P(\text{win}) = \mathrm{pIn}_{S=1,\ g=1}\big(\max(b, F)\big)
```

- If the re-bid fails, the class is lost and only the refund is kept.
- "Up to what you paid" is an assumption: the sources give only the cap.
- The simulation does not know that a freed seat may draw fewer or more bidders than a seat offered at the start of a window.

In code: `refundCapCents`, `refundCents`, `snipeMoney`, `snipeSimInput` (seats 1, group 1, the window's forecast parameters) and `snipeChance` in `site/src/lib/snipe/snipe.ts`.

### Planner: joint probability across courses

The planner picks one bid per section to maximise the chance of getting what the student needs within an e\$ balance $`B_{\text{bal}}`$. Each item $`i`$ has a bid $`b_i`$ and a chance $`p_i = \mathrm{pIn}_i(b_i)`$ from its own simulation (seats left now, the chosen window's forecast, 20,000 runs); a bid below the minimum has $`p_i = 0`$.

Items are required, optional, or members of a one-of group (any one of several sections or courses will do). Treating sections as independent, the chance of getting everything needed is

```math
P_{\text{all}} = \prod_{i \in \text{required}} p_i \;\cdot\; \prod_{G \in \text{groups}} \Big(1 - \prod_{i \in G} (1 - p_i)\Big)
```

The optimiser maximises

```math
J = P_{\text{all}} + 0.1 \sum_{i \in \text{optional}} p_i - \kappa(s)\, \frac{\sum_i p_i b_i}{B_{\text{bal}}}, \qquad \kappa(s) = 1.2\,(1 - s)^2, \qquad \sum_i b_i \le B_{\text{bal}}
```

where $`s \in [0, 1]`$ is the user's "save e\$" to "be sure" setting and $`\sum_i p_i b_i`$ is the expected spend, since only successful bids are charged.

- At $`s = 1`$ the spend penalty vanishes.
- The sum of all bids placed must fit the balance, since any of them might succeed.
- The search is coordinate ascent over each bid on a 50-cent grid, started from four points (the minimum bids, and each section's bid for 50%, 80% and 95%), followed by a refinement within 49 cents using odd values only.

In code: `evaluate` (the products and the optional term), `pAllOf` (the reported joint chance, without optional items), `kappa`, `ascend`, `solve`, `optimise` and `tradeoff` (the trade-off curve over $`s`$) in `site/src/lib/sim/planner.ts`, run in the worker through `runOptimise` and `runTradeoff` in `client.ts`.

## Evaluation

**Held-out term backtest.** For a target term the model is fitted only on earlier terms (with the recency weights above), then forecasts every section in every window of the target term as BOSS offered it (the seats actually offered, a group of 1, 1,500 replays), and each forecast is scored against the real outcome $`a`$: the minimum successful bid if the section filled, the floor otherwise. Three terms play different roles:

- 2024-25 Term 2 is the validation term. Calibration (`calibrate` in `fit.py`):
  - picks $`r \in \lbrace 0.4, 1, 2.5 \rbrace`$ by the Brier score of $`\Pr(\text{fill})`$
  - keeps $`c_w \in \lbrace 0, 1 \rbrace`$ and three alternative $`\tau`$ sets only if the Brier score improves by more than $`10^{-4}`$
  - scales the price level twice by $`\exp(\mathrm{median} \ln(a / \text{conditional } p_{50}))`$ over filled sections
  - picks $`\ell_{sd} \in \lbrace 0.1, 0.25, 0.4 \rbrace`$ whose filled-section 80% coverage is closest to 0.8
  - decides whether the slot effects stay on
  - Results: $`r = 0.4`$, $`c_w = 0.5`$, $`\tau`$ as in the table above, price scale 1.380, $`\ell_{sd} = 0.1`$, slot effects on (`model/forecast/out/calibration.json`).
- 2025-26 Term 2 is the test term, used for the gate.
- 2026-27 Term 1 is held out: reported, not part of the gate. The corrected model's GBM hyperparameters were also tuned on the test term, so test-term figures for the corrected model are optimistic and the held-out term is the honest one.

**Metrics** (`summarize`, `_agg`, `pair_order` in `fit.py`):

- Average miss $`\overline{|p_{50} - a|}`$ over all forecasts.
  - On sections that filled it uses the median of the replays that filled (conditional $`p_{50}`$), scored on the filled sections the baseline could also forecast.
- 80% range coverage.
  - Over all forecasts: the share where the randomised probability integral transform $`u = \Pr(C < a) + U \cdot \Pr(C = a)`$ lies in $`[0.1, 0.9]`$ (a literal $`p_{10} \le a \le p_{90}`$ check would read far too high because ties at the floor are common).
  - On filled sections: the share with $`p_{10} \le a \le p_{90}`$.
  - Target: about 80%.
- Brier score of $`\Pr(\text{fill})`$ against the fill outcome, versus a hard baseline and climatology (the weighted fill rate per window).
- Pair order: for pairs of filled sections of one course, term and window with different slot keys and unequal actual clearing bids, how often the conditional $`p_{50}`$ orders them like the actual bids (ties count half).
- Baseline, "reuse last term's clearing bid": for the same window, the same section's clearing bid, else the same course and instructor, else the same course, taken from the latest earlier term of the same term type (else the latest earlier term).

**Gate** (`main` in `fit.py`). Forecasts go live only if, on the test term, coverage is in range (0.75 to 0.85 over all forecasts and 0.70 to 0.90 on filled sections) and the model beats the baseline (lower average miss overall and on filled sections, and a Brier score below both baselines).

Otherwise the parameter file is written under a `.rejected` name and the site shows no forecasts.

Per window, the site marks confidence "low" unless filled-section coverage is within 70 to 90% on at least 50 filled sections (`window_confidence` in `build_site_data.py`).

**Results of the 15 Nov 2026 calibration on 2026-27 Term 1** (from `distcal.json` and `accuracy.json`). There were 7,894 forecasts, of which 1,902 were for sections that filled. The forecast was made without this term's results, and the range exponents were learned on 2025-26 Term 2.

- Brier score of $`\Pr(\text{fill})`$: 0.099 with the classifier, against 0.121 from the replays.
- 80% range on filled sections: the real clearing bid fell inside it 78% of the time (90% before), at about half the width. The width is 0.54 of the old median width, measured on the terms used to choose the calibration.
- Median miss on sections that filled: e\$7.77.

**Bid styles (17 Nov 2026 refit, 21:36).** Measured win rate on filled sections, by cross-fit between 2025-26 Term 2 and 2026-27 Term 1. This flatters the method a little: one fold tests an earlier term with levels picked on a later one, and each pick uses range exponents learned on the term it then tests. The no-look-ahead figures under Rolling harness are the honest ones, and on the last complete term (2026-27 Term 1) the method won 61.7%, 79.8% and 85.5%; term-to-term drift of this size is the largest open risk (see Limitations).

| Round | Filled sections | Cheap | Balanced | Safe |
|---|---|---|---|---|
| Target | | 70% | 85% | 90% |
| Round 1 Window 1 | 616 | 72% | 87% | 92% |
| Round 1A | 1,411 | 71% | 85% | 91% |
| Round 1B | 551 | 70% | 85% | 87% |
| Round 2 | 675 | 69% | 84% | 88% |
| Round 2A | 170 | 64% | 79% | 79% |
| All | 3,423 | 70% | 85% | 89% |

Round 2A falls short on Cheap and Safe, and the site says so there, showing the measured rate instead of the model's. Its figure is rough: each fold picks Round 2A's level on one term's 47 to 123 filled sections. Checked against the following term's actual results over three term triples, this measurement missed Round 2A by 5 points on average (the earlier rule, which used the pooled level, missed by 14). Each fold also picks its levels with range exponents learned on the term it then tests, so the test is not fully clean, and the table measures the procedure rather than the exact shipped numbers.

**Rolling harness** (`evalharness.py`). This replays the whole procedure with no look-ahead.

Each scored term gets exponents and levels learned only on the two terms before it, and bids are rounded as on the site.

Pooled over the four complete terms it can score, the per-group method won 68.9%, 84.0% and 89.2% of filled sections, at mean bids of e\$20.30, e\$25.14 and e\$28.47.

The previous single global level won 77.1%, 83.6% and 89.6%, at e\$21.87, e\$24.27 and e\$28.40. Its Cheap level was fixed at 90%, so Cheap won well above its 70% aim and cost more; the new Cheap is cheaper by design.

**Not shipped.** `promisecal.py` tried split-conformal multipliers on the conditional price, per window group, seat class and forecast band. It met its targets on average (70.2%, 84.5% and 94.9%), but it failed per round, with Round 2A Cheap at 62.9%. It also bid e\$4 to e\$14 more than the previous single level (+4.1, +8.8 and +13.9 on average), mostly on sections that never fill, because it ignores the fill chance.

**Before the calibration (9 Nov 2026).** Results on 2026-27 Term 1, a term excluded from training, before Round 1A Window 2 was forecast. This is a retrospective result, not a prospective one: the correction was chosen with this term's scores in view, so treat it as optimistic. Figures are from `backtest.json` and `backtest-corrected.json` as of 9 Nov 2026; both are regenerated at each refit, so the "How it works" page on the site shows the current median miss. 7,243 forecasts, of which 1,696 were for sections that filled. Amounts in e\$.

| Measure | Fit only | Fit plus correction | Reuse last term's bid |
|---|---|---|---|
| Average miss, sections that filled (same sections as the baseline) | 13.05 | 11.49 | 20.20 |
| Median miss, sections that filled | 8.84 | 7.76 | not computed |
| Average miss, all forecasts (same sections as the baseline) | 5.02 | 4.93 | 6.97 |
| Real bid inside the 80% range, sections that filled | 80.5% | 83.2% | not applicable |
| 80% range coverage, all forecasts | 81.7% | 82.3% | not applicable |
| Order of same-course sections (1,006 pairs) | 68.4% | 68.6% | not computed |

The Brier score of $`\Pr(\text{fill})`$ is 0.118 on the sections the baseline could forecast, against 0.2255 for a hard last-term baseline and 0.165 for climatology; the correction does not change it (the fill classifier above does).

The baseline could forecast 6,989 of the 7,243 sections.

## Limitations

- Past results only. The model has no information about this term's drops, released seats, quota changes, a new instructor or rule changes. Later windows offer only newly freed seats, and the data records that a seat was offered again but not why.
- Before the fill classifier of 15 Nov 2026, the chance of filling was over-confident in the middle of the range: on the 2025-26 Term 2 backtest, forecasts of 30 to 40% filled 19% of the time (`calibration` in `backtest-corrected.json`). Its Brier score is better (0.099 against 0.121 on 2026-27 Term 1), and the rolling harness rechecked its calibration on 17 Nov 2026: well calibrated overall (expected calibration error 0.010), but a little overconfident in the upper middle (forecasts of 0.6 to 0.7 filled 59% of the time, 0.7 to 0.8 filled 70%), and the term's overall fill rate drifts (2026-27 Term 1: 21.1% predicted, 24.1% actual).
- The 80% range of filled sections stayed within the 70 to 90% band in both test terms, but windows from Round 2 Window 3 onward have few filled sections and are marked low confidence. Forecasts for windows further ahead are less certain than the held-out figures, which score each window with earlier-window results of the same term in the corrected model.
- The price model is one lognormal plus a spike at the minimum. Bidders who copy "last median plus a dollar or two" and round-number bids are not modelled beyond the anchor share.
- Demand and price are fitted per window with no link between windows. $`\sigma`$, $`q`$ and $`s`$ are shared by all courses in a window, and $`s`$ is shared across windows and ignores the slot effect.
- The hierarchy double-counts a child's data (see above). Slot effects rest on crude proxies for demand and carry no uncertainty forward.
- The correction rescales the price level only and is trained on filled sections only. The range factors are learned from two terms in five forecast-level bands, each split into one seat or several, so a cell with fewer than 100 filled sections borrows from its band, and a band from all sections.
- Bidding is blind, so nobody sees others' bids. A section with 1 seat left clears at the single highest bid and swings a lot. Late rounds (Round 2 Window 3 and Round 2A) have few seats and few bids and were the least reliable.
- Ties are settled by random draw among the tied bids, but rivals are assumed to bid independently of each other and of the group; a bid exactly equal to the cutoff can therefore read very low for a large group (for example three seats for a group of three against ten rivals all at the floor). The recommended odd-cent bids avoid round-number ties.
- Seat counts for some sections are estimates from the previous window and can be wrong, for example when reserved seats are released or students drop.
- The planner treats sections as independent, which is optimistic when students compete for the same seats in correlated ways. It flags timetable clashes but does not model e\$ rollover rules or credit limits.
- The evaluation reads bids from a 99-point grid that stops at the 99th conditional percentile, so at level 0.995 (Round 2 and 2A Safe) it scores a slightly cheaper bid than the site shows on sections likely to fill (`tests/test_forecast_bid_parity.py`). With every replay kept, the 17 Nov 2026 review measured the effect at under 0.5 points of win rate and up to e\$1.9 of bid on filled sections.
- Bid styles promise a win rate only on sections that fill. Their levels come from two terms, and Round 2A (170 filled sections) falls short at 64%, 79% and 79%; that figure is rough. Every round drifts between terms: on 2026-27 Term 1 the shipped procedure won 62%, 80% and 86% of filled sections overall, against about 72%, 86% and 91% measured on the two terms before it.
- The swap chance, its settings, and the drop-and-re-bid chance have not been tested against real outcomes; the percentages are rough guides for ranking options. The drop chance counts past cases of the same course, which are correlated within a term.

## Running locally

The data the model is trained on is not published, so the forecast pages cannot be reproduced from this repository alone. The site and the tests run without it.

Site (needs Node: Astro 5 supports 18.20.8, 20.3 or 22 and later):

```sh
cd site
npm install
npm run dev     # http://localhost:4321
npm test        # vitest unit tests
npm run check   # astro check
npm run build   # static build into site/dist
```

The data pages read generated JSON from `site/src/data/real/`, which is not in the repository. To produce it you need a bid-results CSV with the columns `term, window, course_code, section, class_number, instructor, median_bid, min_bid, no_bids, vacancy, before_process_vacancy, after_process_vacancy, days, start_times` and the other columns in `tests/fixtures/site_data_fixture.csv`, which is a small synthetic example. Then:

```sh
# from the repository root
python -m model.forecast.fit --csv <bids_with_schedule.csv> --out model/forecast/out
python -m model.forecast.correction backtest --csv <bids_with_schedule.csv> --fit-out model/forecast/out   # optional; needs numpy, pandas, scikit-learn
python model/build_site_data.py --csv <bids_with_schedule.csv>
```

The current term (2026-27 Term 2) and the parameter file name are hard-coded in `fit.py` and `build_site_data.py`.

`fit.py` calibrates and backtests on the fixed terms named in the Evaluation section, so it needs several terms of real history; it will not run meaningfully on the synthetic fixture.

The site-data build alone works on the fixture, without forecasts:

```sh
python model/build_site_data.py --csv tests/fixtures/site_data_fixture.csv \
  --current-term "2025-26 Term 2" --out /tmp/bidwise-site-data
```

## Tests

Python tests cover the fit (censoring, shrinkage, slot effects, pair order), the simulator (parity with the TypeScript engine on fixed seeds) and the site-data build. From the repository root:

```sh
PYTHONPATH=. python3 -m unittest tests.test_forecast_fit tests.test_forecast_sim \
  tests.test_build_site_data tests.test_site_data_s1
```

TypeScript tests cover the simulator, bid styles, planner, swap and drop-and-re-bid maths, caching and the page helpers; run them with `npm test` in `site/`. The site shows the bid styles only when the forecast metadata carries the calibrated levels, so run the suite in both modes:

```sh
npm test                                    # as the data on disk stands
BIDWISE_FORCE_BIDLEVELS=calibrated npm test # every test sees calibrated bid levels
```

The TypeScript suite passed in both modes on 17 Nov 2026.

More detail: `docs/model-plain.md` for a plain-language summary and `docs/model-technical.md` for a longer technical write-up with a worked example. Both were written before the 15 Nov 2026 calibration and the bid styles, so this README is the current reference.
