# How Bidwise forecasts bids

## What it predicts

For a section in a bidding window: the bid it will take to get a seat (with a range), and the chance that a given bid gets one.

## What it learns from

Past BOSS results: seats offered, seats taken, lowest and median winning bids. When a section filled, the results only say at least that many people bid.

## What it adjusts for

Course, professor, time slot (early, evening, Friday), seats on offer, and window, each fitted separately. With little history on a professor, it leans on the course, then the subject, then all courses. Recent terms count more.

## How the chance comes about

The model estimates how many students will bid and how much each bids, then replays the window 20,000 times. Each replay gives the seats to the highest bids. The chance for your bid is the share of replays it won: "about 90%" means 90 of 100.

## How accurate it was

On unseen terms, for sections that filled in 2026-27 Term 1, the average miss was e$13.05, against e$20.20 for reusing last term's clearing bid, and the real bid fell inside our 80% range 81% of the time. In 2025-26 Term 2: e$15.28 against e$21.80, and 84%. One weakness: for sections with a middling chance of filling, it predicted "fills" more often than it happened.

## What it can't know

A new professor, rule changes, drops or released seats, and what this term's students decide. Seat counts marked ≈ are estimates.

## Swap chance

A swap trades your section for another in the same course, and works only if someone there wants yours. SMU publishes no swap results, so nothing is fitted to real swaps. The figure depends on how many students hold each section and how much more or less wanted the other is, judged by its predicted bid. About one in ten holders is assumed to apply, leaning towards the more wanted section. These settings are our judgment: a rough guide only.
