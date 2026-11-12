// Funny team radio for bot teammates (Battle vs bots): a big pool per moment, shuffled and dealt out
// without repeats until the pool runs dry, so the jokes do not wear thin.
const LINES = {
  start: [
    "Alright team, remember the plan. There is no plan.", "I stretched for this. Mostly my patience.", "Who brought snacks? Nobody? Classic.",
    "Let's make this quick, my mum's calling me for dinner.", "I've got a good feeling about this. That's usually a bad sign.", "Helmets on. Brains optional.",
    "Rule one: don't die. Rule two: see rule one.", "I'm running on three hours of sleep and pure spite.", "Last one to the fight buys the pizza.",
    "If I die first, tell my plants I loved them.", "Okay, who unplugged the strategy?", "I read the manual. Ate it, actually.",
  ],
  kill: [
    "Got one! Somebody clip that.", "And stay down!", "Tagged him. Sorry, not sorry.", "That's what you get for camping in my favourite corner.",
    "Bonk. Delivered.", "One down! I'm basically a legend now.", "Did you see that? Please say you saw that.", "He'll be back. He always comes back. Eugh.",
    "Clean. Like my room. Which is not clean.", "Sending him back to the lobby.", "I meant to do that. Totally meant to.", "Easy! Okay, it was not easy.",
    "That one's going on the fridge.", "Respawn timer, meet my friend.",
  ],
  niceShot: [
    "Nice shot! Teach me your ways.", "Okay show-off.", "Wow. Did you practise in the range? Nerd. Respect.", "Clean kill! I'll take the credit, thanks.",
    "Who is this player? Can I have your autograph?", "Absolute cinema.", "That was filthy. Do it again.", "Someone's been eating their vegetables.",
    "That's my teammate! Well. Today it is.", "I was softening him up for you. You're welcome.", "Remind me never to make you angry.",
  ],
  mateDown: [
    "Man down! Well, man lying down.", "Noooo, he owed me money!", "Tell my side of the story!", "I'm fine. I'm totally fine. Just very dead.",
    "Ow. My everything.", "That was a tactical nap.", "I died so you could live. Mostly by accident.", "Who put a floor there?!",
    "I blame lag. And gravity. And him.", "Spectating you now. No pressure.", "I'll be back. Grab me a coffee.",
  ],
  hurt: [
    "I'm hit! It's just a flesh wound!", "Ow! Who ordered the bullets?", "Medic! Oh right, we don't have one.", "Falling back! Very bravely!",
    "That stung. Emotionally, too.", "I'm leaking, I'm leaking!", "Getting out of here before it gets worse. It's getting worse.",
  ],
  reload: [
    "Reloading! Look at something else!", "Hold on, the bullets fell out again.", "New mag! Smells like victory. And gun oil.",
    "Reloading, keep them busy. Tell them a joke.", "Changing mags, don't look, I'm shy.", "Out of ammo! In my defence, there were a lot of them.",
  ],
  idle: [
    "Anyone else hear that? No? Just me then.", "Quiet. Too quiet. I hate it.", "If this goes well, I'm asking for a raise.", "My knees are not built for crouching.",
    "Does anyone know where the bathroom is on this map?", "I think I'm lost. Again.", "Is it just me, or are those crates following us?",
    "Fun fact: I have no idea what I'm doing.", "I've been holding this angle for ages. My eyes are drying out.", "What's everyone having for tea after this?",
    "Keep your head down. Unless you're tall. Then just crouch more.", "Psst. I'm doing great. Just so everyone knows.",
  ],
  winning: [
    "We're winning! Act casual.", "Don't jinx it. Nobody say anything. ...Too late.", "Keep it up, they're crying in their chat.", "This is going suspiciously well.",
  ],
  losing: [
    "We are losing. Gracefully. Ish.", "New plan: be better.", "Okay, okay, comeback time. Any second now.", "They're not that good. We're just that bad.",
  ],
};
export class Banter {
  constructor(rng = Math.random) { this.rng = rng; this.decks = {}; }
  line(kind) {
    let deck = this.decks[kind];
    if (!deck || !deck.length) {
      deck = this.decks[kind] = (LINES[kind] || []).slice();
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    }
    return deck.pop() || '';
  }
}
