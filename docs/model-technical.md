# Bidwise forecast model: technical description

Status as of 9 November 2026. Every formula below is read from the code, and file:line references point at it. Paths are relative to `repo/`. `fit.py` means `model/forecast/fit.py`; `sim.py` is `model/forecast/sim.py`, the Python mirror of `site/src/lib/sim/index.ts` (same xoshiro128** generator seeded by splitmix32, same sampling order, so equal seeds give equal results up to libm differences; `sim.py:1-8`).

The pipeline has two halves. Python (`fit.py`) fits, per section and window, seven parameters `SimParams` (`sim.py:18-29`) and writes them to JSON. The site (`site/src/lib/sim/index.ts`) draws replays of the window from those seven numbers in the browser.

Notation: $S$ seats offered, $N$ bidders, $\lambda=E[N]$, $r$ NB dispersion, $m$ median bid level (cents), $\sigma$ bid spread, $q$ anchor share, $F$ the minimum bid (floor) in cents.

## 1. Data and observations

One observation is one row of Overall Results: a section in one bidding window of one term (`Obs`, `fit.py:51-69`; `build_obs`, `fit.py:132-155`).

| Field | Definition | Code |
|---|---|---|
| seats $S$ | `before_process_vacancy`, the seats offered in that window (not the section's total capacity) | `fit.py:151` |
| successful $B$ | $S-\text{after\_process\_vacancy}$ | `fit.py:151` |
| filled | after-process vacancy $=0$ | `fit.py:145` |
| `mn`, `med` | minimum and median of successful bids, in cents (`mn=0` if there were no bids) | `fit.py:152` |
| floor $F$ | $1000$ cents, unless a course's lowest observed minimum is e$11 to e$20 and at least 3 rows sit within a cent of it | `course_floors`, `fit.py:100-114` |
| slot | time bucket of the first meeting plus `_fri` if the first listed day is FRI | `fit.py:79-89` |

Rows are dropped if $S\le 0$, after-vacancy is negative or above $S$, or the term is not "Term 1/2" (3A and 3B are tiny), or the window is not one of the 11 listed in `WINDOWS` (`fit.py:36-40, 137-144`). Windows are matched on the exact BOSS label, so each window has its own parameters. With the current dataset this gives 177,391 CSV rows and 72,341 usable observations, from 2022-23 Term 1 onward. Rows from the term being forecast, or later, are excluded from training (`fit.py:268-270`).

**Censoring.** If the section did not fill, every bidder succeeded, so $N=B$ exactly. If it filled, only $N\ge S$ is known (right-censored). `censored_demand`, `fit.py:168-170`. For the clearing bid: if the section did not fill, every bid at or above the floor succeeds, so the clearing bid is the floor; if it filled, the clearing bid is the lowest successful bid `mn` (pay-as-bid, highest bids win, ties random). The backtest target is therefore $a=\texttt{mn}$ if filled else $F$ (`actual_cutoff`, `fit.py:554-555`).

## 2. Demand model

$$N\sim\mathrm{NegBin}(\text{mean }\lambda,\ \text{size }r),\qquad \Pr(N=c)=\frac{\Gamma(c+r)}{\Gamma(r)\,c!}\left(\frac{r}{r+\lambda}\right)^{r}\left(\frac{\lambda}{r+\lambda}\right)^{c},\qquad \mathrm{Var}\,N=\lambda+\lambda^2/r .$$

`NBTables.logpmf`, `fit.py:198-205`. The dispersion $r$ is a single global constant chosen in calibration (currently $r=0.4$, a heavy-tailed count; `fit.py:259`, `backtest.json`).

**Likelihood of one observation $o$ (weight $w_o$)**, with $\lambda_o=\lambda\,e^{\beta^d(\text{slot}_o,w)}$ (section 5):

$$\ell_o(\lambda)=w_o\cdot\begin{cases}\log\Pr(N=B_o\mid\lambda_o) & \text{unfilled}\\ \log\Pr(N\ge S_o\mid\lambda_o)=\log\Big(1-\sum_{j<S_o}\Pr(N=j\mid\lambda_o)\Big) & \text{filled}\end{cases}$$

The survival term is `NBTables.logsf`, `fit.py:207-222` (floored at $10^{-300}$). The likelihood is computed on a grid $x_j=\log\lambda_j=\ln 0.02+0.1\,j$, $j=0..107$ (`fit.py:41-43`), shifted by $\mathrm{round}(\beta^d/0.1)$ grid steps for the observation's slot (`_shift`, `fit.py:313-314`, `dpost` `fit.py:331-333`). Then the posterior over the grid is

$$p(x_j)\;\propto\;\exp\Big(\sum_o \ell_o(e^{x_j})-\frac{(x_j-\mu)^2}{2\tau^2}\Big),$$

`grid_posterior`, `fit.py:180-188`, returning $E[x]$ (`mean_x`), $\mathrm{sd}(x)$ and $E[e^x]$ (`mean_exp`). $\mu$ and $\tau$ come from the hierarchy (section 4).

## 3. Bid model

Each of the $N$ bidders is, independently, either anchored or not:

- with probability $q$ (`anchorShare`) the bid is $F+200\,U$ cents, $U\sim\mathrm{Unif}(0,1)$ (`anchorCents`$=F$);
- otherwise the bid is $M\,e^{\sigma Z}$, $Z\sim N(0,1)$ (`priceSigma` $=\sigma$), where $M=m\,e^{s_M\,Z_M}$, $Z_M\sim N(0,1)$ drawn once per replay (`anchorSigma` $=s_M$), so the whole window's price level shifts together.

Bids are rounded to whole cents and raised to $F$ if below it (`sim.py:182-193`, `index.ts:69-82`). The clearing bid is the $S$-th highest bid ($k$-th for groups, section 7).

**How the parameters are fitted** (`Model._fit_price_globals`, `fit.py:353-394`; `_nhat_z_raw`, `fit.py:346-351`).

*Order-statistic scores.* For a filled section, take the course-level posterior mean $\bar\lambda_c=E[\lambda]$ for that window, $\hat N=\max\big(S,\ E[N\mid N\ge S]\big)$ (`nb_tail_mean`, `fit.py:225-243`) and $n_s=(1-q)\hat N$ non-anchored bidders. The expected normal score of the $k$-th highest is

$$z(k)=\Phi^{-1}\!\Big(\mathrm{clip}_{[0.02,\,0.98]}\frac{n_s-k+0.625}{n_s+0.25}\Big),\qquad z_S=z(S),\quad z_{\mathrm{med}}=z\big(\tfrac{S+1}{2}\big).$$

so that $\ln(\text{clearing bid})\approx\ln m+\sigma z_S$.

*Spread $\sigma_w$ (per window).* The median successful bid is the $\frac{S+1}{2}$-th highest and the minimum successful bid is the $S$-th, so
$\ln(\texttt{med}/\texttt{mn})\approx\sigma\,(z_{\mathrm{med}}-z_S)$. Over filled sections with $\texttt{mn}>F+200$ and $\texttt{med}>\texttt{mn}$:

$$\hat\sigma_w=\mathrm{clip}_{[0.15,\,0.9]}\frac{\sum_o w_o\ln(\texttt{med}_o/\texttt{mn}_o)}{\sum_o w_o\,(z_{\mathrm{med},o}-z_{S,o})},$$

or $0.4$ if the denominator is $\le 3$ (`fit.py:373-380`).

*Anchor share $q_w$ (per window).* Take unfilled sections with $B\ge 3$ and $\texttt{med}>0$. Let $f$ be the weighted share whose median is within $F+200$. Under the model, the median of $B$ bids sits in the anchor band when at least $\lceil B/2\rceil$ of them are anchored, so $g(q)=\overline{\Pr[\mathrm{Bin}(B,q)\ge \lfloor (B+1)/2\rfloor]}$ (weighted mean over those sections). $q_w=\arg\min_{q\in\{0,0.05,\dots,0.9\}}|g(q)-f|$ (`fit.py:360-372`). With fewer than 30 such sections $q_w=0.3$ (`fit.py:364-365`); for Round 1 Window 1 and Round 1B Window 1 there are 3,750 and 559, so $q=0.3$ there is an estimate, not the fallback.

*Residual sd $s$.* The pooled within-(course, instructor, window) standard deviation of $y_o=\ln \texttt{mn}_o-\sigma_w z_{S,o}$ over filled sections with $\texttt{mn}>F+200$, floored at 0.2, or 0.4 with 10 or fewer degrees of freedom (`fit.py:381-394`, `_y` `fit.py:396-398`). Currently $s=0.373$. It is one number for all windows.

*Price level.* $x=\ln m$ per (window, group) has a Gaussian prior from the hierarchy and a Tobit likelihood over filled sections only (`ppost`, `fit.py:400-421`):

$$y_o=\ln\texttt{mn}_o-\sigma_w z_{S,o}-\beta^p(\text{slot}_o,w)\sim N(x,\ s^2)\quad\text{if }\texttt{mn}_o>F+200;$$

and if $\texttt{mn}_o\le F+200$ the clearing bid is hidden in the anchor band, so the term is left-censored, $w_o\log\Phi\big((y^c_o-x)/s\big)$ with $y^c_o=\ln(F+200)-\sigma_w z_{S,o}-\beta^p$. Grid: $\ln 500+0.05\,j$, $j=0..89$ (`fit.py:44-45`).

**Prediction** (`Model.params_for`, `fit.py:424-444`), at the course $\times$ instructor group $ci$:

$$\lambda=E[e^{x}\mid ci]\;e^{\beta^d},\qquad m=\max\!\big(F,\ e^{E[\ln m\mid ci]+\beta^p}\,c_{\text{scale}}\big),$$
$$\sigma=\hat\sigma_w,\quad q=q_w,\quad s_M=\sqrt{\ell_{sd}^2+\mathrm{sd}(\ln m\mid ci)^2},$$

where $c_{\text{scale}}=$ `price_scale` $=1.350$ and $\ell_{sd}=$ `level_sd` $=0.1$ (term-to-term drift of the price level). So `priceLevelCents` is $m$, `anchorSigma` is $s_M$, `anchorShare` is $q$, `anchorCents` is $F$, `demandMean` is $\lambda$, `demandDispersion` is $r$. Demand uses the posterior mean on the natural scale, price uses the posterior mean on the log scale (a median).

## 4. Partial pooling

**Hierarchy.** Four levels, each fitted inside one window: all courses $g$, subject $s$, course $c$, course $\times$ instructor $ci$ (`LEVELS`, `fit.py:47`; `key`, `parent`, `fit.py:288-305`). Every observation is added to the group of all four levels (`fit.py:280-283`). Each group's posterior is a grid posterior (section 2) whose Gaussian prior is centred on its parent's posterior mean:

$$\mu_{\text{group}}=E[x\mid\text{parent}],\qquad \mu_g=\ln 5\ (\text{demand}),\ \ln 2000\ (\text{price}),\qquad \tau_{\text{level}}.$$

(`dpost`, `fit.py:317-336`; `ppost`, `fit.py:400-421`.) Calibrated and default values (`Config`, `fit.py:247-259`):

| Level | $\tau_d$ (log $\lambda$) | $\tau_p$ (log $m$) |
|---|---|---|
| $g$ | 3.0 | 3.0 |
| $s$ | 1.0 | 0.5 |
| $c$ | 0.9 | 0.4 |
| $ci$ | 0.7 | 0.3 |

A group with no observations returns its prior, so a new instructor inherits the course posterior, a new course inherits the subject, and so on. A small $\tau$ means the group stays close to its parent. With $n$ weighted observations the data pull is roughly $n/(n+\kappa)$; `pool_weight` (`fit.py:159-161`) computes this with $\kappa=2$ only for the diagnostic `weights.ci` in the output, not for estimation.

**Time decay and cross-term weight.** For a target term with index $t^*$ and an observation from term $t_o$ (index $t=2\cdot\text{start year}+\text{term}-1$, `fit.py:72-76`):

$$w_o=\delta^{(t^*-t_o)/2}\cdot\begin{cases}1&\text{same term type}\\ c_w&\text{otherwise}\end{cases},\quad\delta=0.7\text{ per year},\ c_w=0.5$$

(`obs_weight`, `fit.py:164-165`; applied at `fit.py:271`; terms with $w\le10^{-3}$ are dropped). `cross_w` ($c_w$) is the Term 1 to Term 2 weight, and it applies symmetrically (Term 2 rows count half when forecasting Term 1). Weights multiply each observation's log-likelihood, as fractional counts. `Post.wsum` is $\sum w_o$ and `Post.n` is the unweighted count.

**`pooledLevel` and `nObs`** (`fit.py:430-444`). `pooledLevel` is the finest level that has at least one training observation in that window: `course×instructor` if the $ci$ group is non-empty, else `course`, `subject`, `global`. `nObs` is the unweighted observation count of the $ci$ group only, so it is 0 whenever `pooledLevel` is coarser.

## 5. Time-slot effects

Slot key: first meeting's start $\le 08{:}30$ is early, $\ge 18{:}00$ is late, else mid; plus `_fri` if the first listed day is FRI (BOSS lists days alphabetically, so FRI comes first). Six keys: `early, mid, late, early_fri, mid_fri, late_fri` (`fit.py:46, 79-89`).

*Contrasts* (`_slot_contrasts`, `fit.py:453-472`). Within each (term, window, course) cell that has at least one `mid` section, each non-mid section $o$ is compared with the cell's mid sections:

- demand: $\Delta^d_o=\ln\!\big(1+L_o/S_o\big)-\overline{\ln(1+L_i/S_i)}_{i\in\text{mid}}$ with $L=S$ if filled else $B$ (a lower bound for $N$);
- price (only if $o$ filled and the cell has filled mid sections): $\Delta^p_o=\ln\texttt{mn}_o-\overline{\ln\texttt{mn}_i}_{i\in\text{mid, filled}}$.

*Estimates* (`estimate_slot_effects`, `fit.py:475-486`), for slot key $k$ with $n_k$ contrasts:

$$\beta^d_k=\mathrm{round}_{0.1}\Big(2\cdot\overline{\Delta^d}\cdot\tfrac{n_k}{n_k+30}\Big),\qquad \beta^p_k=\overline{\Delta^p}\cdot\tfrac{n_k}{n_k+30}.$$

The factor 2 is because the proxy is compressed relative to $\log\lambda$. Estimates are made once over all training rows (pooled) and again per window; a window uses its own value only when it has at least 30 contrasts for that key, else the pooled one (`estimate_slot_effects_by_window`, `fit.py:489-502`). Contrasts are not time-weighted.

*Use.* In fitting, each observation is moved to the `mid` scale: its demand likelihood is evaluated at $\lambda e^{\beta^d}$ and its price $y$ has $\beta^p$ subtracted (`fit.py:331-333, 412`). At prediction the section's own slot effect is added back (section 3). Calibration keeps slots on unless the same-course ordering accuracy drops by more than 2 points or Brier worsens by more than 0.0002 (`fit.py:715-721`); it was kept.

## 6. Simulation on the site

Code: `site/src/lib/sim/index.ts:50-126` (TypeScript), `sim.py:163-238` (identical Python). Inputs: seats $S$ (live seats left for the section, `sectionSim.ts:11-21`), group size $g$ (1 to 6, `forecast.ts:5, 24-27`), floor $F$, the seven parameters, `runs`, `seed`. The course page uses `FORECAST_RUNS=20000`, `FORECAST_SEED=12345` (`forecast.ts:9-10`).

For each replay, with $k=S-g+1$:

1. Draw $N\sim\mathrm{NegBin}(\lambda,r)$ as $\mathrm{Poisson}\big(G\cdot\lambda/r\big)$, $G\sim\mathrm{Gamma}(r,1)$ (`rng.ts:128-131`, `sim.py:155-160`).
2. If $N<k$ (or $k\le0$ and $N=0$), the seats are not contested: cutoff $=F$. The replay counts as filled only if $N\ge k$.
3. Otherwise draw the level shock $M=m\,e^{s_M Z}$ and $N$ bids (anchored or lognormal, section 3), round, floor at $F$.
4. Cutoff $=$ the $k$-th highest of the $N$ bids, i.e. the $(N-k)$-th smallest, by quickselect (`index.ts:25-48, 85`). If $k\le0$, cutoff $=F$.

So a section with $S$ seats clears at the $S$-th highest bid among the other bidders, and at the minimum bid when fewer than $S$ bid. A group of $g$ friends who all bid $b$ all get in iff fewer than $k=S-g+1$ other bidders bid above $b$.

*Outputs.* Sort the cutoffs $C_1\le\dots\le C_R$. $\hat P_{\text{fill}}=$ `pFill` $=\#\{\text{filled}\}/R$. Percentiles $p_q=C_{\lfloor qR\rfloor}$ (`index.ts:89-90`): the site shows $p_{50}$ and $p_{90}$ from this, and the 10th percentile of the range is read off the chance curve (`cutoffAt`, `forecast.ts:33-47`). The chance of a seat for bid $b$ counts ties as half:

$$\mathrm{pIn}(b)=\frac{\#\{C_i<b\}+\tfrac12\#\{C_i=b\}}{R},$$

evaluated on up to 120 grid points from $F$ to $\max(F+100,\lceil1.15\,p_{99}\rceil)$ and linearly interpolated (`index.ts:92-142`). The recommended bid for a target (80, 90, 95%) is the smallest odd-cent bid with $\mathrm{pIn}\ge$ target (`recommendBid`, `index.ts:146-161`; odd cents to avoid ties with round-number bids). The swap view uses 4,000 runs (`swapSim.ts:10`); the home-page highlights use 20,000 runs, same seed (`build_site_data.py:53-55`).

## 7. Fit, validation and the gate

**Terms** (`fit.py:671-673`): calibration on 2024-25 Term 2; test on 2025-26 Term 2; held out 2026-27 Term 1. Each backtest fits only on terms before the target term, forecasts every section in every window of that term (group 1, seats $=S$ offered, 1,500 runs, seed $1000+i$) and scores against $a$ (`backtest`, `fit.py:558-569`, `predict_all`, `fit.py:523-531`).

**Calibration** (`calibrate`, `fit.py:676-723`, on the validation term only): $r\in\{0.4,1,2.5\}$ by Brier score of $\Pr(\text{fill})$; $c_w\in\{0,1\}$ and three alternative $\tau_d$ sets, each kept only if Brier improves by more than $10^{-4}$; `price_scale` multiplied twice by $\exp(\mathrm{median}\ln(a/\text{cond. }p_{50}))$ over filled sections; `level_sd` $\in\{0.1,0.25,0.4\}$ with filled-conditional 80% coverage closest to 0.8; slot on/off. Result: $r=0.4$, $c_w=0.5$, $\tau$ as in section 4, `price_scale` 1.350, `level_sd` 0.1, slot on.

**Metrics** (`_agg`, `fit.py:601-639`):

- MAE: $\overline{|p_{50}-a|}$ over all forecasts, and over filled sections using the median of the replays that filled (conditional $p_{50}$). The site's "average miss on sections that filled" is the conditional one, scored on the filled sections the baseline could also forecast (`build_site_data.py:647-677`).
- Coverage of the 80% range: the share of forecasts where the randomized PIT lies in $[0.1,0.9]$, $u=\Pr(C<a)+U\cdot\Pr(C=a)$ (`fit.py:646`; ties at the floor make the literal $p_{10}\le a\le p_{90}$ test read 97.6% and 95.4%). For filled sections: share with $p_{10}\le a\le p_{90}$ (unconditional percentiles), which is the site's "real bid inside 80% range".
- Baseline "reuse last term's clearing bid": for the same window, the clearing bid of the same section, else same course and instructor, else same course, from the latest earlier term of the same term type, else the latest earlier term (`naive_baseline`, `fit.py:534-551`).
- Brier of $\Pr(\text{fill})$ against the fill outcome, versus a hard baseline and a climatology (weighted fill rate per window).

Figures (from `model/forecast/out/backtest.json`, `site/src/data/real/accuracy.json`):

| Term | Forecasts | Filled | Filled MAE, model vs baseline | 80% range, filled | All-forecast MAE, model vs baseline | 80% coverage, all |
|---|---|---|---|---|---|---|
| 2025-26 Term 2 (test) | 8,679 | 1,302 | e$15.28 vs e$21.80 | 84.3% | e$3.59 vs e$6.19 (baseline on 8,167) | 81.9% |
| 2026-27 Term 1 (held out) | 7,243 | 1,696 | e$13.05 vs e$20.20 | 80.5% | e$5.16 vs e$6.97 (baseline on 6,989) | 81.7% |

**The gate** (`fit.py:788-810`). On the test term, `forecasts_ok` requires both:

- coverage in range: $0.75\le$ coverage80 $\le0.85$ and $0.70\le$ coverage80Filled $\le0.90$;
- beats baseline: model MAE below baseline MAE on the same samples, filled conditional MAE below the baseline's, and model Brier below both the hard and climatology Brier.

If it fails, the params are written to `params-2026-27-term-2.rejected.json`, and `build_site_data.py` skips forecasts (`load_forecast_params`, `build_site_data.py:567-578`). The held-out term is reported but does not enter the gate. Per window, confidence is `ok` only if filled-section coverage is in $[0.70,0.90]$ on at least 50 filled sections, else `low` (`build_site_data.py:64-65, 599-605`).

## 8. Swap chance

Site-only model, no fitting: `site/src/lib/swap/swap.ts`. A holder of section A asks about section B of the same course.

**Desirability $d$** (`desirabilities`, `swap.ts:222-248`), on the Round 1 Window 1 forecast (`SWAP_WINDOW`, `swap.ts:11`):

- Normal course: $v_s=\ln p_{50,s}+0.25\ln(\lambda_s/S_s)$ (`rawDesirability`, `swap.ts:210-212`; `TIE_WEIGHT=0.25`, `swap.ts:45`). $p_{50,s}$ is the simulated median bid, group 1, the section's full seat count, 4,000 runs, seed 12345 (`swapSim.ts:13-17`). The second term breaks ties between sections that all clear at the minimum.
- Pre-assigned course: $v_s=\ln(\texttt{priceLevelCents})$ from the same window's forecast, which already includes the slot effect; no simulation.
- $d_s=v_s-\mathrm{median}_s(v)$. A section with no usable forecast uses the last-term fallback: log of its matched median bid over the course median, or 0 if nothing matches (`fallbackDesirability`, `swap.ts:185-204`).

**Pre-assigned detection** (`swap.ts:14-23, 93-102`): over Round 1 Window 1 / 1A Window 1 history rows with vacancy $>0$ and `before` known, if the median of $\texttt{before}/\texttt{vacancy}<0.25$ and there are at least 3 rows. The code comment cites 131 courses flagged.

**Holders** (`holdersIn`, `swap.ts:109-116`): $n=\lfloor\text{seats}\rfloor$; in a pre-assigned course $n=\max\big(1,\ n-\mathrm{round}(\mathrm{median}(\texttt{before}))\big)$ using that section's own Round 1 Window 1 rows, else the course's.

**Request probability** (`swap.ts:119-121`): $p(A\to B)=r\,\sigma_{\text{logistic}}\big(k\,(d_B-d_A)\big)$ with $r=0.1$, $k=5.5$ (`swap.ts:31-32`).

**Direct-pair chance** (`swapChance`, `swap.ts:140-151`): $X\sim\mathrm{Bin}(n_A-1,\,p_{AB})$ other holders of A applying for B, $Y\sim\mathrm{Bin}(n_B,\,p_{BA})$ holders of B applying for A. Up to $\min(1+X,Y)$ swaps can happen and the applicants from A share them equally:

$$P(\text{swap})=E\!\left[\frac{\min(1+X,\ Y)}{1+X}\right]=\sum_{x}\Pr(X=x)\,\frac{1}{x+1}\sum_{j=1}^{\min(x+1,\,n_B)}\Pr(Y\ge j),$$

using $E[\min(m,Y)]=\sum_{j=1}^m\Pr(Y\ge j)$, exact in $O(n_A+n_B)$. Cycles through three or more sections are ignored.

**Band and label** (`swapResult`, `swap.ts:165-170`). Evaluate at the centre $(r,k)=(0.1,5.5)$ and the four corners $r\in\{r/1.5,\,1.5r\}$, $k\in\{k/1.25,\,1.25k\}$ (`R_BAND=1.5`, `K_BAND=1.25`); low and high are the min and max. The label comes from the central chance only: likely if $\ge0.75$, unlikely if $<0.4$, else possible (`swap.ts:35-38, 160-162`); unknown if either side has no seats.

**The anchors are judgment, not fitted** (`swap.ts:1-6`). SMU publishes no swap outcomes. $r$ and $k$ were set so the central chance lands on chosen target ranges: about 60 to 70% when equally wanted, 80 to 90% when the other section is less wanted, 20 to 40% when more wanted, under 15% when much more wanted. I re-implemented `swapChance` in Python to check this for $n_A=n_B=45$, with $\Delta d=d_B-d_A$:

| $\Delta d$ | $-0.25$ | $-0.10$ | $0$ | $+0.20$ | $+0.40$ |
|---|---|---|---|---|---|
| central chance | 92.6% | 79.8% | 64.4% | 29.8% | 10.7% |
| band | 81 to 99% | 68 to 90% | 57 to 71% | 22 to 39% | 6 to 17% |

## 9. Worked example: MGMT102 section G9 (class 1099), THU 08:15

Parameters from `site/src/data/real/courses/MGMT102.json`. The slot is `early`, $F=1000$, 48 seats in total. The numbers below also reproduce when re-running the fit on the current dataset.

| | Round 1 Window 1 | Round 1B Window 1 |
|---|---|---|
| $ci$ group: $E[\lambda]$ (4 / 3 past results, weighted 2.38 / 1.68) | 298.9 | 11.1 |
| $ci$ group: $E[\ln m]$ → $e^{\cdot}$ (2 filled results, weighted 1.19) | 7.149 → 1273.1 | 7.277 → 1446.7 |
| $\beta^d$, $\beta^p$ for early | $-0.1$, $-0.092$ | $-0.1$, $-0.137$ |
| $\lambda=E[\lambda]\,e^{\beta^d}$ | 270.42 | 10.05 |
| $m=e^{E[\ln m]+\beta^p}\times1.3502$ | 1567.8 | 1703.2 |
| $\sigma$, $q$, $r$ | 0.502, 0.3, 0.4 | 0.7378, 0.3, 0.4 |
| $s_M=\sqrt{0.1^2+\mathrm{sd}^2}$ (sd $=0.225$) | 0.2467 | 0.2467 |
| `pooledLevel`, `nObs` | course×instructor, 4 | course×instructor, 3 |

Simulation (20,000 runs, seed 12345, group 1, run with `sim.py`, which mirrors the site):

| | Round 1 W1, 48 seats (the swap view's seat count) | Round 1B W1, 1 seat left (live) |
|---|---|---|
| $\Pr(\text{fill})$ | 60.8% | 73.1% |
| $p_{50}$ | e$11.73 | e$26.54 |
| $p_{90}$ | e$32.96 | e$86.66 |
| pIn at e$15.00 | 57.2% | 38.9% |
| pIn at e$30.00 | 86.4% | 53.6% |
| bid for 90% (odd cents) | e$32.97 | e$86.71 |

Reading the first column: only 61% of replays fill, so the median replay cutoff is just above the floor; a bid of e$15.00 beats the cutoff in 57.2% of replays (counting ties as half), and e$30.00 in 86.4%. In Round 1B Window 1 the one remaining seat is contested by about 10 bidders with a wide bid spread ($\sigma=0.74$), so the chance climbs slowly with the bid.

## 10. Known limits

- Past results only. No information on this term's drops, released seats, or coordinator interventions; later windows offer only newly freed seats.
- Hierarchy reuse: every observation sits in all four levels, and a child's prior mean is its parent's posterior, which already contains the child's data. The child's data is therefore counted at both levels, so this is not a strict Bayesian hierarchy.
- Fill probability is over-confident in the middle: on the test term, forecasts of 30 to 40% filled 19% of the time, and 10 to 20% filled 7% of the time (`calibration` in `backtest.json`). The 80% range held for filled sections in both tests (84% and 81%); per the site text, windows from Round 2 Window 3 onward have few filled sections and are marked low confidence.
- The price model is one lognormal plus a floor spike; bidders who copy "last median plus e$1 to 2" and round-number bids are not modelled beyond the anchor share.
- Demand and price are fitted per window with no link between windows, and $\sigma$, $q$, $s$ are shared by all courses in a window. $s$ is also shared across windows, and its residuals ignore the slot effect.
- Slot effects use crude proxies for demand (lower bound of $N$, ×2 scale) and are shrunk by $n/(n+30)$ with no uncertainty carried forward.
- Seats for some sections are estimated from the previous window and can be wrong.
- At a bid exactly equal to the floor, pIn counts uncontested replays as a tie and so reads half of their mass; one cent above the floor it reads in full. The recommended odd-cent bids avoid this.
- The pre-assigned course path and every swap number rest on judgment settings, with no outcome data to test them.

## 11. Mismatches with the site text

Compared against `site/src/pages/method.astro` and related site code. The code is treated as right.

1. Cross-term weight: `method.astro` says Term 1 results count half as much when forecasting Term 2. The code halves any other term type, both ways (`fit.py:164-165`). It also never states the 0.7 per year decay in numbers.
2. Past-result counts: `pooledText` in `site/src/lib/sim/forecast.ts:58-65` shows "`nObs` past results for this course (other instructors)" and similar for subject or all courses, but `nObs` is the course×instructor count and is 0 at those levels (`fit.py:435, 444`). Example: MGMT102 G11, Round 1B Window 1 has `pooledLevel` "course", `nObs` 0, so the page reads "0 past results for this course (other instructors)".
3. Swap comment: `swap.ts:218` says the pre-assigned level is "pooled over all windows". The value used is the Round 1 Window 1 forecast's `priceLevelCents` (`swap.ts:230`), and the fit is per window (`fit.py:287-295`). `method.astro` itself says only "forecast bid level for the section's instructor and time slot".
4. "Average miss" in the filled-section table is, in the code, the median of replays that filled (conditional), scored on the filled sections the baseline could forecast, not the unconditional middle value that `method.astro` describes as "the forecast's middle value". The all-forecast table uses the unconditional $p_{50}$.
5. "Last term's clearing bid" (site text and the accuracy label) is, in the code, the latest earlier term of the same term type for that section (else course and instructor, else course) (`fit.py:547`), so for a Term 2 forecast it is last Term 2, not the immediately preceding term.
6. `method.astro` says "Window timing is not modelled beyond fitting each window separately", but slot effects (early, late, Friday) are fitted per window with a pooled fallback when a window has fewer than 30 contrasts for that slot (`fit.py:489-502`).
7. The "10th to 90th percentile" range: the site draws the low end from the chance curve (`forecast.ts:33-47`), the high end and the median from the sorted percentiles, while the backtest checks sorted percentiles from 1,500 runs. These agree up to interpolation.
