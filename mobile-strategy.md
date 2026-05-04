# Mobile strategy notes

Saved from a conversation with Neal about whether trip planning works
on a phone. Decision deferred until after Iceland dogfood — these are
the working notes to revisit when the question comes up again.

---

## Honest answer to "can planning be done on a phone"

Yes for some kinds of planning, no for what Max currently is.

### Planning that works fine on a phone

- **Single-destination trips.** "Flying to Lisbon for 5 days." Linear
  scrolling, swipe to add, fine on mobile. Wanderlog and TripIt prove
  this works.
- **Idea-gathering / dreaming.** Browsing destinations, saving
  inspiration, "hey friend, what about this?" Phone is BETTER than
  laptop here — you're casually researching in idle moments.
- **Conversational planning.** "I want to go to Iceland for two
  weeks" → LLM responds → "Add Reykjavik for 3 nights." Voice + chat
  is mobile-native. The artifact the sibling Claude was scoping is
  this shape.
- **Refinement and small mutations.** "Move Hôtel-Dieu de Beaune from
  Day 3 to Day 4." One-tap edit, no problem.

### Planning that doesn't work on a phone

- **Multi-destination sequencing.** Looking at 14 destinations,
  deciding which becomes a day trip, dragging things around — needs
  a grid, side-by-side comparison, tri-pane map+list+detail. Doesn't
  fit a phone screen.
- **Side-by-side comparison.** Three hotels next to each other with
  reviews and photos. Phones do this poorly.
- **Complex form-filling.** Logistics forms with 10 fields per side.
  Doable but slow.
- **The Max picker as it exists today.** Two columns of activities
  and places, hover-to-see-details, scroll within scroll. A mobile
  redesign would be a complete rewrite.

### The honest read on Max specifically

Max is built around *structured commitment* — once you've decided to
go to Switzerland, sequence it. That's laptop work. Mobile is for the
moment AFTER the trip is structured (adjusting on the fly, executing
on the trail).

But if the future of Max is chat-driven planning ("hey Max, plan me a
road trip in Iceland for 10 days, self-drive"), then phone planning
becomes natural. The conversation IS the picker — no tabs, no grids,
just turn-by-turn dialogue. That's what the sibling Claude's artifact
was prototyping.

---

## The strategic question

What does the next version of Max's planning look like?

- **Path A:** Keep the structured planner Max has. Desktop-first stays.
  Phone is execution-only. Wanderlog model. Real and shippable.
- **Path B:** Add a chat layer ON TOP of the structured planner. Same
  data underneath, conversational front-end. User can plan on phone
  via chat, see the structured trip on either device. Both surfaces
  work for both purposes.
- **Path C:** Replace the structured planner with chat-first. Big
  rewrite. The artifact the sibling was scoping is this direction.

**Path B is the most interesting.** Chat-driven planning works on
phone; structured planning works on laptop; both backed by the same
trip object; both visible across devices. The choreographer engine
(Max's actual moat) lives underneath both UIs.

That said — **don't decide this from theory**. Use Max for Iceland as
it is. See where the desktop UX hurts and where it sings. See if you
find yourself wishing you could plan on the move. The product instinct
will be obvious after a real trip.
