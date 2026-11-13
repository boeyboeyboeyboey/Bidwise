import type { APIRoute } from 'astro';
import { getCourseIndex } from '../../lib/data';
import { getCourse } from '../../lib/data/server';

// What Plan B needs to price this term's open sections in the browser: per section its seats, time, instructor, minimum
// bid and fitted forecast (the same fields the course page's simulator reads), without history, venues or seat trends.
export const GET: APIRoute = () => {
  const courses = getCourseIndex()
    .filter((c) => c.offeredNow)
    .map((c) => getCourse(c.code))
    .filter((c): c is NonNullable<typeof c> => !!c && c.sectionsNow.length > 0)
    .map((c) => ({
      code: c.code,
      title: c.title,
      sectionsNow: c.sectionsNow.map((s) => ({
        id: s.id, section: s.section, classNumber: s.classNumber, instructor: s.instructor,
        meetings: s.meetings.map((m) => ({ day: m.day, start: m.start, end: m.end })),
        seatsTotal: s.seatsTotal, seatsLeft: s.seatsLeft,
        ...(s.live ? { live: { available: s.live.available, total: s.live.total, source: s.live.source, capturedAt: s.live.capturedAt } } : {}),
        ...(s.minBidCents !== undefined ? { minBidCents: s.minBidCents } : {}),
        ...(s.forecast ? { forecast: s.forecast } : {}),
      })),
    }));
  return new Response(JSON.stringify(courses), { headers: { 'Content-Type': 'application/json' } });
};
