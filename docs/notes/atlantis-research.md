# Stargate Atlantis: research brief for a custom crew deck

Step 1 of `docs/adding-a-custom-crew.md`. This brief covers the show's crew, ships, allies,
places, tech and themes, plus pitfalls and image leads. It designs no cards.

How to read it:

- Episode numbers follow TMDB and Wikipedia: the pilot "Rising" counts as 1x01–1x02, and
  two-parters count as two episodes (so "The Return" is 3x10–3x11 and "First Strike" is 3x20).
- Facts were checked against Wikipedia (character and season articles), the Stargate SG-1
  Solutions wiki (`stargate-sg1-solutions.com`, episode guides), the York episode reviews and
  episode-guide search results. The Stargate Fandom wiki, GateWorld, BoardGameGeek and IMDb
  refused automated fetches, so they were not used.
- **unverified** marks anything I could not confirm from a second source or from the episode
  summaries.
- Traits come only from `src/data/ids.ts`. Avoid `JEM_HADAR`, `VORTA`, `XB`, `HELMET` and
  `MIND_CONTROL`: they are inert in this box, and the validator warns on them. `MIND_CONTROL`
  is tempting for the Wraith and Michael, but it does nothing. Skip `STARFLEET`, `NX_01`,
  `MAQUIS` and `DOMINION`: they are Star Trek institutions.

## 0. Summary

**The show in one paragraph.** In 2004 an international expedition led by Elizabeth Weir goes
through the Stargate to Atlantis, the Ancients' city in the Pegasus galaxy. The city is
underwater and nearly out of power. The expedition wakes the Wraith early ("Rising"). The
Wraith are life-draining aliens who "cull" human worlds. For a year the expedition is cut off
from Earth. Then the Daedalus links the two galaxies ("The Siege" 1x19–2x01). Later threats
are the Genii (season 1–3), the Asurans, human-form Replicators the Ancients built (season
3–4), and Michael, a Wraith turned human and then a hybrid-maker (season 2–5). Shaky
alliances with the Wraith "Todd" run from season 3 to 5. The city flies to Earth in the
finale ("Enemy at the Gate", 5x20).

**The working idea, checked against the show:**

| Idea                                  | Verdict                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sheppard as CAPTAIN                   | Fits. He leads the main gate team (AR-1) and is the military commander. He is **not** the expedition's leader, though. Weir (seasons 1–3), Carter (4) and Woolsey (5) are. His rank is Major, then Lieutenant Colonel from "The Intruder" (2x02). He is never a captain.                                                                                                                                           |
| Puddle Jumper as flagship             | The best fit. It is the team's actual vehicle: it goes through the gate, cloaks and fires drones. It fits "warp + beam" well.                                                                                                                                                                                                                                                                                      |
| The city as flagship                  | Contradicted. The city flies only in the season 4 opener ("Adrift"/"Lifeline", 4x01–4x02) and the finale (5x20), and each flight drains its power. It is a base, not a ship that moves every turn. It fits a LOCATION better. The SIS deck already starts with a LOCATION in play (`startPosition: CONTROLLED_LOCATION`), so that pattern exists. A late "city takes flight" effect could be one Development card. |
| ZPMs as CARGO that power big turns    | Right in spirit, wrong in quantity. The expedition almost never had more than **one** working ZPM. The others it found were dead, nearly dead, left behind, or bait (§5). ZPMs are scarce, decisive and they run dry. One or two ZPM cards that are used up fit; a ZPM economy with many copies does not.                                                                                                          |
| McKay and Zelenka on Research         | Right. Add Carter (season 4) and Keller (medical research). Zelenka is **not** a gene carrier: his therapy failed ("Hot Zone", 1x13).                                                                                                                                                                                                                                                                              |
| Ancient tech that needs gene carriers | Right, and well supported (§1, §5). The gene comes naturally (Sheppard, Beckett) or from Beckett's therapy, which works 48 % of the time (McKay).                                                                                                                                                                                                                                                                  |
| The Wraith as the risk                | Right, and the strongest theme. Two nuances. The expedition **caused** the Wraith's early waking. And some Wraith become allies (Todd, and Michael's faction in "Allies"), so a Wraith ALLY fits as well as Wraith INCIDENTs.                                                                                                                                                                                      |

**Recommended engine/risk:** ZPM power as the engine, the Wraith as the risk, with the
gene-gate as texture (§6, pair A).

## 1. The crew

### 1.1 The ATA gene: who has it

The ATA gene ("Ancient Technology Activation") lets a person run Ancient technology by thought.

| Character                               | Gene?           | How                                                                                                               | Source                           |
| --------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| John Sheppard                           | yes             | Natural. He found out while flying O'Neill to the Antarctic outpost ("Rising", 1x01).                             | Wikipedia                        |
| Carson Beckett                          | yes             | Natural. In "Rising" his gene sets off a drone aimed at O'Neill's and Sheppard's helicopter, and he stops it.     | Wikipedia                        |
| Jack O'Neill                            | yes             | Natural (SG-1 "Lost City").                                                                                       | Wikipedia / RDA lexicon          |
| Rodney McKay                            | yes             | Therapy. He is the first test subject ("Hide and Seek", 1x03).                                                    | Wikipedia                        |
| Evan Lorne                              | yes             | Origin not stated. The Genii kidnap him for it ("Coup d'Etat", 2x17).                                             | Solutions wiki                   |
| Radek Zelenka                           | **no**          | The therapy failed ("Hot Zone", 1x13).                                                                            | Wikipedia                        |
| Aiden Ford                              | unclear         | Asks for the therapy during the nanovirus crisis; the outcome is never stated.                                    | fan-wiki snippet, **unverified** |
| Weir, Carter, Keller, Woolsey, Caldwell | not established | **unverified**: no source states either way                                                                       | —                                |
| Teyla Emmagan                           | no              | She has **Wraith DNA** instead ("The Gift", 1x18). It lets her sense the Wraith and tap their telepathic network. | Wikipedia                        |
| Ronon Dex                               | no              | —                                                                                                                 | —                                |

Facts about the therapy:

- Beckett built it from his own gene ("Hide and Seek"). It works in **48 %** of recipients.
- The Hoffan drug is the one with **50 %** mortality. People mix the two numbers up.
- The gene can be inherited in Pegasus. A royal family in "The Tower" (2x15) has it.
- The Travelers capture Sheppard to activate an Ancient warship ("Travelers", 4x05).
- Fan wikis claim the therapy is "not always permanent" and that Sheppard, Beckett and O'Neill
  share a gene cluster: **unverified**.

**Trait idea for the gene.** No trait means "gene carrier". `AUGMENT` is the closest fit:
the therapy is a genetic upgrade, and MAL already uses `AUGMENT` for River, whom others
experimented on. If the deck gates tech on `AUGMENT`, give it only to carriers: Sheppard,
Beckett, McKay and Lorne, never Zelenka, Teyla or Ronon. `AUGMENT` is rare in the common
market (one card definition), so the deck would supply it itself. The catch: Ford's
Wraith-enzyme strength is also an "augment", so pick one meaning and keep to it.

### 1.2 Main and major recurring characters

Species is `HUMAN` unless noted. Pegasus humans (Athosians, Satedans, Genii) are human too.
Traits are suggestions from `ids.ts`, each with a one-line reason.

#### John Sheppard (Joe Flanigan): military commander, leader of AR-1

- **Role:** a USAF pilot and helicopter pilot at McMurdo. His career stalled after he
  disobeyed an order in Afghanistan to save other servicemen. He takes over as military
  commander when Colonel Sumner dies ("Rising").
- **Skills:** he can fly anything (jumpers, F-302s). He is a natural gene carrier, a team
  leader and a good shot. He plays dumber than he is.
- **Signature moments:**
  - "Rising" (1x01–1x02): discovers his gene in the Antarctic chair. Names the ship "Puddle
    Jumper", overruling Ford's "Gateship One". Kills the Wraith Keeper, which wakes the hive.
    Sumner dies in the same scene; the sources differ on whether Sheppard's shot killed him
    (**unverified**).
  - "Thirty-Eight Minutes" (1x04): a Wraith bug (the Iratus bug) is attached to his neck while
    the jumper is stuck in the gate.
  - "The Siege Part 2/3" (1x20/2x01): a suicide run in a jumper. The Daedalus saves him.
  - "Conversion" (2x08): the Iratus retrovirus turns him into a bug hybrid.
  - "Common Ground" (3x07): Kolya lets a captive Wraith (Todd) feed on him. The two escape
    together, and the Wraith gives his life back.
  - "Irresponsible" (3x13): kills Kolya in a quick-draw showdown.
  - "Outcast" (4x15): his father dies, he reconciles with his brother Dave, and he destroys a
    human-form Replicator on Earth.
  - "The Last Man" (4x20): thrown 48,000 years into the future, where a hologram of an old
    McKay sends him back.
  - "Enemy at the Gate" (5x20): destroys the Wraith super-hive with a nuke.
- **Traits:** `HUMAN`; `PILOT` (his core skill); `AUGMENT` if the deck maps the gene to it;
  `SECURITY` (military commander) as a third option.

#### Elizabeth Weir (Torri Higginson): expedition leader, seasons 1–3

- **Role:** a civilian diplomat and negotiator. She ran the SGC briefly in SG-1 "Lost City".
- **Skills:** diplomacy, treaties and languages. She stays calm as a hostage.
- **Signature moments:**
  - "The Storm" / "The Eye" (1x10–1x11): Kolya's Genii seize the city and hold her and McKay
    hostage. She stalls them.
  - "Before I Sleep" (1x15): an aged Weir from an alternate timeline. She has waited 10,000
    years in stasis to warn them. An Ancient named Janus helped her.
  - "The Long Goodbye" (2x16): an alien consciousness (Phoebus) takes over her body.
  - "The Real World" (3x06): a nanite infection makes her believe Atlantis was a delusion
    (that the nanites cause it is **unverified**).
  - "First Strike" / "Adrift" / "Lifeline" (3x20–4x02): badly hurt, saved by reactivated
    nanites, then left on Asuras to cover the team's escape.
  - "Ghost in the Machine" (5x05): returns as a Replicator consciousness and sacrifices
    herself to stop the others. Michelle Morgan plays her here.
- **Traits:** `HUMAN`; `AMBASSADOR` (a diplomat); `COMMUNICATION` (languages, negotiation).
  A later-seasons card could be `SYNTHETIC` (the nanites, Replicator Weir).

#### Rodney McKay (David Hewlett): chief scientist

- **Role:** a Canadian astrophysicist and head of science. He is arrogant and a hypochondriac,
  with a claimed citrus allergy. McKay is his only expedition-wide constant.
- **Skills:** Ancient technology, physics, improvised engineering. He has the gene through
  therapy.
- **Signature moments:**
  - "Hide and Seek" (1x03): first therapy subject. A personal shield he can't switch off.
  - "Trinity" (2x06): his attempt to run an Ancient power experiment (Project Arcturus)
    destroys much of a solar system. It costs him Sheppard's trust.
  - "Duet" (2x04): Lt. Laura Cadman's mind is stuck in his body.
  - "Grace Under Pressure" (2x14): trapped in a sinking jumper. He survives with the help of a
    hallucinated Carter.
  - "The Hive" (2x11): takes a huge dose of the Wraith enzyme.
  - "McKay and Mrs. Miller" (3x08): his sister Jeannie, and an alternate McKay.
  - "Tao of Rodney" (3x14): an Ancient device gives him superpowers. He must ascend or die.
  - "The Shrine" (5x06): a dementia-like illness. He confesses his love for Keller.
  - "Brain Storm" (5x16): he and Keller get together.
- **Traits:** `HUMAN`; `SCIENTIST` (his core skill); `ENGINEER` (improvised fixes);
  `AUGMENT` if the gene maps to it.

#### Teyla Emmagan (Rachel Luttrell): Athosian leader, AR-1

- **Role:** daughter of Tagan and leader of the Athosians, a people of traders and farmers who
  revere the Ancestors.
- **Skills:** stick-fighting, strategy and Pegasus diplomacy. She knows every trading partner.
  Her Wraith DNA lets her sense and influence the Wraith.
- **Signature moments:**
  - "Rising" (1x01–1x02): the first Pegasus people the expedition meets. The Wraith cull Athos.
  - "Suspicion" (1x05): suspected of being a spy. Her people move to the mainland.
  - "The Gift" (1x18): her Wraith DNA is revealed. It comes from a rogue Wraith's experiments
    on her ancestors.
  - "Misbegotten" (3x02): flies a Wraith hive ship.
  - "Spoils of War" (4x12): takes over a Wraith Queen by telepathy (boosted by her unborn
    child).
  - "The Kindred" (4x18–4x19): Michael captures her for her child.
  - "Search and Rescue" (5x01): gives birth to Torren John Emmagan.
  - "The Queen" (5x08): poses as Todd's Wraith Queen.
  - "The Prodigal" (5x14): kills Michael by throwing him from the top of the control tower.
- **Traits:** `HUMAN`; `TELEPATH` (her Wraith-DNA link); `AMBASSADOR` (her people's leader,
  negotiator). `BUSINESS` (trader) is an alternative.

#### Ronon Dex (Jason Momoa): Satedan soldier, AR-1 from season 2

- **Role:** a former Satedan soldier ("Specialist"). The Wraith made him a "Runner" for seven
  years: a tracker in his back, hunted for sport.
- **Skills:** strength, survival and close combat. He carries an energy pistol and endless
  hidden knives.
- **Signature moments:**
  - "Runner" (2x03): captures Sheppard and Teyla. Beckett removes his tracker.
  - "Sateda" (3x04): back on his ruined homeworld, he gets his revenge on the Wraith who made
    him a Runner.
  - "Reunion" (4x03): old Satedan comrades turn out to be Wraith worshippers.
  - "Midway" (4x17): spars with Teal'c and passes his IOA review.
  - "Broken Ties" (5x03): the Wraith brainwash him through his old friend Tyre.
  - "Tracker" (5x09): plays a Runner again to save Keller.
- **Traits:** `HUMAN`; `SECURITY` (soldier). His gun is a separate `WEAPON` item (§5).

#### Aiden Ford (Rainbow Sun Francks): Marine lieutenant, seasons 1–2

- **Role:** Sheppard's second on AR-1 in season 1.
- **Signature moments:**
  - "The Siege Part 3" (2x01): a Wraith tries to feed on him. Its enzyme floods his body and
    leaves him strong, paranoid and addicted, and he flees in a jumper.
  - "The Lost Boys" / "The Hive" (2x10–2x11): leads a band of enzyme addicts against a hive.
    He is last seen as the hive explodes. His fate is never settled.
- **Traits:** `HUMAN`; `SECURITY` (Marine). After the enzyme: `AUGMENT` or `SHADY`, but see
  the gene caveat in §1.1.

#### Carson Beckett (Paul McGillion): chief medical officer, seasons 1–3 (clone later)

- **Role:** a Scottish doctor and geneticist. He is a natural gene carrier but a reluctant
  jumper pilot. Fans call him the "heart of Atlantis".
- **Signature moments:**
  - "Rising" (1x01): his gene accidentally fires a drone at O'Neill's helicopter.
  - "Hide and Seek" (1x03): creates the gene therapy.
  - "Poisoning the Well" (1x07): helps the Hoffans finish their anti-Wraith drug.
  - "Instinct" / "Michael" (2x07/2x18): his retrovirus to make Wraith human.
  - "Sunday" (3x17): killed by an explosive tumour he was removing.
  - "The Kindred" (4x18–4x19): a clone Michael made of him is found alive.
  - "Enemy at the Gate" (5x20): the clone flies the city to Earth from the chair.
- **Traits:** `HUMAN`; `DOCTOR`; `AUGMENT` if the gene maps to it.

#### Radek Zelenka (David Nykl): Czech engineer and scientist

- **Role:** second only to McKay on Ancient tech, and his friendly rival. Fans call him
  "Mr. Bad News".
- **Signature moments:**
  - "Thirty-Eight Minutes" (1x04): first appearance. Helps free the jumper stuck in the gate.
  - "The Storm" (1x10): plans the shield against the hurricane with McKay.
  - "Hot Zone" (1x13): his gene therapy didn't work.
  - "Tao of Rodney" (3x14): McKay saves him and apologises for years of put-downs.
  - "Enemy at the Gate" (5x20): builds the wormhole drive that moves Atlantis to Earth in
    seconds.
- **Traits:** `HUMAN`; `ENGINEER`; `SCIENTIST`. No gene trait.

#### Evan Lorne (Kavan Smith): major, leads the second gate team

- **Role:** joins in season 2. He acts as military second when Sheppard is away. His first
  appearance is in SG-1, "Enemy Mine" (7x07).
- **Signature moments:**
  - "Coup d'Etat" (2x17): the Genii kidnap him for his gene.
  - "No Man's Land" (3x01): commands the Ancient warship Orion against the hives bound for
    Earth.
  - "The Game" (3x15): his team finds the worlds being steered by Ancient satellites.
  - "Sunday" (3x17): paints Atlantis (painting is his hobby, learned from his mother).
  - "First Strike" (3x20): F-302 squadron leader.
- **Traits:** `HUMAN`; `PILOT`; `SECURITY`; `AUGMENT` if the gene maps to it.

#### Jennifer Keller (Jewel Staite): chief medical officer from season 4

- **Role:** a prodigy doctor who was reluctant to take the job. Her first appearance is
  "First Strike" (3x20). Jewel Staite also played Ellia, the Wraith girl in "Instinct" (2x07),
  a different character.
- **Signature moments:**
  - "Missing" (4x07): stranded with Teyla on New Athos. She discovers Teyla is pregnant.
  - "Trio" (4x16): trapped in an old Genii mine with Carter and McKay.
  - "The Seed" (5x02): infected so that a Wraith ship grows from her.
  - "Tracker" (5x09): kidnapped by a Runner, and wins him over.
  - "The Queen" / "Infection" (5x08/5x17): her gene therapy to free the Wraith from feeding.
    It is the core of the deal with Todd, and in "Infection" it weakens the hive crew's
    immune systems.
- **Traits:** `HUMAN`; `DOCTOR`; `SCIENTIST` (her Wraith gene therapy).

#### Samantha Carter (Amanda Tapping): expedition leader, season 4

- **Role:** a USAF colonel and astrophysicist from SG-1. The IOA puts her in charge early in
  season 4. She leaves after "Search and Rescue" (5x01), and in "Enemy at the Gate" (5x20) is
  due to command the BC-304 George Hammond (formerly the Phoenix).
- **Signature moments:**
  - "Be All My Sins Remember'd" (4x11): leads the allied fleet. She and McKay sink the
    Replicator mass into Asuras's core.
  - "Trio" (4x16): trapped with McKay and Keller.
  - "Midway" (4x17): brings in Teal'c.
  - "Search and Rescue" (5x01): leads the rescue from Michael's base.
- Earlier cameos: "Letters from Pegasus" (1x17) and as McKay's hallucination in "Grace Under
  Pressure" (2x14).
- **Traits:** `HUMAN`; `SCIENTIST`; `PILOT` or `ENGINEER`. Gene status **unverified**.

#### Richard Woolsey (Robert Picardo): IOA man, expedition leader in season 5

- **Role:** a lawyer and bureaucrat (MBA, JD), formerly NID and IOA. He grows from by-the-book
  into an effective leader.
- **Signature moments:**
  - "Misbegotten" (3x02): evaluates Weir.
  - "The Return" (3x10–3x11): trapped in the city with O'Neill by the Asurans.
  - Season 5: takes command from Carter ("Search and Rescue", 5x01).
  - "Inquisition" (5x13): defends the expedition before a Coalition tribunal.
  - "The Prodigal" (5x14): helps Teyla and her son escape Michael.
  - "Remnants" (5x15): an IOA review, and an alien AI's projection of a woman he likes.
  - "Vegas" (5x19): an FBI agent in an alternate reality.
- **Traits:** `HUMAN`; `BUSINESS` (bureaucrat, oversight); `AMBASSADOR` (the tribunal
  defence, negotiation with Todd).

#### Steven Caldwell (Mitch Pileggi): colonel, commander of the Daedalus

- **Role:** a career officer who wanted Sheppard's job.
- **Signature moments:**
  - "The Siege Part 3" (2x01): arrives and rescues Sheppard.
  - "The Intruder" (2x02): a Wraith computer virus on his ship.
  - "Critical Mass" (2x13): revealed as an unknowing Goa'uld host of the Trust, who used him to
    plant a bomb in Atlantis.
  - "The Long Goodbye" (2x16): returns to duty.
  - "Be All My Sins Remember'd" (4x11): the fleet attack.
- **Traits:** `HUMAN`; `OPS` or `SECURITY` (a ship commander). `SPY` would fit a "Critical
  Mass" card.

#### Others worth a card

| Character                            | Who                                                                             | Key episodes                                                          | Trait ideas                                 |
| ------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------- |
| Hermiod                              | Asgard engineer aboard the Daedalus                                             | season 2 on                                                           | `ALIEN` `ENGINEER` (no Asgard trait exists) |
| Halling                              | Athosian elder; Christopher Heyerdahl, who also plays Todd                      | season 1 on                                                           | `HUMAN`                                     |
| Jinto                                | Halling's son; releases the shadow entity                                       | "Hide and Seek" (1x03)                                                | `HUMAN`                                     |
| Kanaan                               | Athosian, father of Teyla's son; Michael turns him into a hybrid                | "Missing", "The Kindred"                                              | `HUMAN`                                     |
| Laura Cadman                         | Marine; her mind lands in McKay's body                                          | "Duet" (2x04)                                                         | `HUMAN` `SECURITY`                          |
| Kate Heightmeyer                     | psychologist; killed by an entity                                               | "Doppelganger" (4x04)                                                 | `HUMAN` `DOCTOR`                            |
| Marshall Sumner                      | first military commander; dies in the pilot                                     | "Rising"                                                              | `HUMAN` `SECURITY`                          |
| Dillon Everett                       | Marine colonel leading the reinforcements                                       | "The Siege Part 2/3"                                                  | `HUMAN` `SECURITY`                          |
| Peter Grodin                         | gate technician; said to die on the Ancient satellite                           | "The Siege" (death **unverified**)                                    | `HUMAN` `OPS`                               |
| Jeannie Miller                       | McKay's sister, a mathematician                                                 | "McKay and Mrs. Miller", "Miller's Crossing"                          | `HUMAN` `SCIENTIST`                         |
| Lucius Lavin                         | con man; a herbal drug makes everyone adore him; later uses the personal shield | "Irresistible" (3x03), "Irresponsible" (3x13)                         | `HUMAN` `SHADY` `BUSINESS`                  |
| Kavanagh                             | difficult scientist; sets off Midway's self-destruct                            | "Midway" (4x17)                                                       | `HUMAN` `SCIENTIST`                         |
| FRAN                                 | a friendly Replicator McKay built                                               | "Be All My Sins Remember'd" (4x11)                                    | `SYNTHETIC`                                 |
| Jack O'Neill, Daniel Jackson, Teal'c | SG-1 guests                                                                     | "Rising", "The Return" / "First Contact", "The Lost Tribe" / "Midway" | `HUMAN` (Teal'c: `ALIEN`)                   |

## 2. Ships

| Ship                                  | What it is                                                                                                                                                                         | Key episodes                                                                                                                                                                            | What it could do on a card                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Puddle Jumper**                     | Small Ancient gate-capable craft. It has a cloak and drone launchers and needs a gene carrier to fly. Sheppard named it in "Rising" (Ford wanted "Gateship One").                  | "Rising", "Thirty-Eight Minutes" (stuck in the gate), "Grace Under Pressure" (sinks), "The Siege Part 2" (suicide run), "Midway" (escape)                                               | The natural flagship: warp (through the gate), beam an Away Team, cloak. A drone attack as an ATTACK. |
| **Atlantis** (the city-ship)          | Ancient city with a shield, a stardrive, a control chair and drones, and (**unverified**) a cloak. Needs ZPMs for anything big.                                                    | flies in "Adrift"/"Lifeline" (4x01–4x02) and "Enemy at the Gate" (5x20)                                                                                                                 | Better as a LOCATION (§4). One rare, costly "the city flies" effect fits.                             |
| **Daedalus** (BC-304)                 | Earth's battlecruiser, Caldwell commanding. Asgard hyperdrive and beaming, the Asgard Hermiod aboard. Its first mission brings a ZPM and links the galaxies.                       | "The Siege Part 3" (2x01), "The Intruder", "Critical Mass", "Inferno" (evacuation), "Allies", "The Daedalus Variations" (5x04, alternate Daedaluses), "First Contact" (Todd hijacks it) | Beaming is this ship's identity. A mid-game arrival (the supply line from Earth) fits the Reserve.    |
| **Apollo** (BC-304)                   | A second Earth battlecruiser. Its commander is Colonel Ellis (**unverified**).                                                                                                     | "First Strike" (3x20), "Lifeline" (rescue), "Be All My Sins Remember'd", "Outcast", "Remnants"                                                                                          | A strike ship: an attack, then beam out.                                                              |
| **Odyssey, George Hammond** (BC-304s) | Mostly SG-1 ships. The Phoenix is renamed George Hammond, Carter's command after 5x20. Per the Solutions wiki, a ZPM from "The Return" went to boost the Odyssey (**unverified**). | cameo level in SGA                                                                                                                                                                      | Probably not worth a card.                                                                            |
| **F-302**                             | Earth fighter carried by the BC-304s.                                                                                                                                              | "First Strike" (Lorne's squadron)                                                                                                                                                       | —                                                                                                     |
| **Orion** (Ancient warship)           | Found on Taranis as the _Hippaforalkus_. Sheppard renamed it.                                                                                                                      | found "Inferno" (2x19); Lorne commands it, and it is destroyed, in "No Man's Land" (3x01)                                                                                               | A big, short-lived warship.                                                                           |
| **Aurora** (Ancient warship)          | Crew in stasis, living in a shared virtual world.                                                                                                                                  | "Aurora" (2x09); destroyed at the end                                                                                                                                                   | Information from a VR, a dying ship.                                                                  |
| **Tria**                              | The Ancient Helia's ship. About 100 Ancients come back on it and reclaim the city.                                                                                                 | "The Return" (3x10–3x11)                                                                                                                                                                | —                                                                                                     |
| **Traveler ships**                    | Generation ships of humans who live in space to stay away from the Wraith. They also own an Ancient warship that needs the gene.                                                   | "Travelers" (4x05); six ships join the fleet in "Be All My Sins Remember'd" (4x11)                                                                                                      | An ALLY or a second SHIP.                                                                             |
| **Wraith hive ship**                  | Organic, self-repairing, ruled by a queen. Many at once in a siege.                                                                                                                | "Rising", "The Siege", "The Hive", "No Man's Land", "Misbegotten" (Teyla flies one), "Spoils of War"                                                                                    | The threat: an INCIDENT. A captured hive could be a SHIP.                                             |
| **Wraith cruiser**                    | Smaller Wraith warship.                                                                                                                                                            | "Critical Mass", "Search and Rescue" (Michael's)                                                                                                                                        | —                                                                                                     |
| **Wraith dart**                       | Fighter with a "culling beam" that dematerialises people and stores them.                                                                                                          | "Rising", "The Brotherhood" (a kamikaze dart), "Duet" (McKay and Cadman beamed up)                                                                                                      | The cull: remove an Away Team or a beamed PERSON.                                                     |
| **Wraith super-hive**                 | A hive powered by ZPMs. It heads for Earth.                                                                                                                                        | "Enemy at the Gate" (5x20)                                                                                                                                                              | The finale threat.                                                                                    |
| **Asuran warships**                   | Copies of Ancient warships.                                                                                                                                                        | "Progeny" (3x05), "First Strike", "Be All My Sins Remember'd"                                                                                                                           | —                                                                                                     |

## 3. Allies and antagonists

| Group / character                                  | Who they are                                                                                                                                                                                                                                                                            | Key episodes                                                                                                                                                                                                                                                                                  | Fit                                                                                                                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Athosians** (Halling, Jinto, Kanaan, Charin)     | Teyla's people: traders, farmers. Culled in "Rising". Live on the mainland after "Suspicion" (1x05), later on New Athos. Michael abducts them ("Missing", 4x07).                                                                                                                        | "Rising", "Suspicion", "Missing", "The Kindred"                                                                                                                                                                                                                                               | ALLY: trade, Influence, {LAT}. `HUMAN` `BUSINESS`.                                                                                                                                |
| **Genii**: Cowen, Acastus Kolya, Ladon Radim, Sora | A militaristic people who pose as simple farmers. They live in bunkers underground and build atomic bombs.                                                                                                                                                                              | "Underground" (1x08), "The Storm"/"The Eye" (1x10–1x11), "The Brotherhood" (1x16), "Coup d'Etat" (2x17: Ladon overthrows Cowen), "Common Ground" (3x07), "Irresponsible" (3x13: Kolya killed), "Trio" (old Genii mine)                                                                        | Kolya: `HUMAN` `SECURITY` `SHADY` (raider, the classic villain). Ladon: `HUMAN` `SHADY` (schemer turned leader). The Genii as a whole: `SPY` (their whole society is a disguise). |
| **Todd** (Christopher Heyerdahl)                   | A Wraith commander and on-off ally.                                                                                                                                                                                                                                                     | "Common Ground" (3x07), "The Seer" (4x08: proposes an alliance), "Be All My Sins Remember'd" (seven hives), "Spoils of War" (4x12), "The Queen" (5x08), "First Contact"/"The Lost Tribe" (5x10–5x11: hijacks the Daedalus), "Infection" (5x17), "Enemy at the Gate" (warns of the super-hive) | ALLY, `ALIEN` `TELEPATH` `SHADY`. "The enemy of my enemy". The writers' nickname "Todd" is first used on screen in "Spoils of War" (**unverified**, IMDb trivia).                 |
| **Michael** (Connor Trinneer)                      | A Wraith that Beckett's retrovirus turned human ("Michael", 2x18). He turns back, is shunned by the Wraith, and builds human-Iratus hybrids and plagues.                                                                                                                                | "Allies" (2x20), "Misbegotten" (3x02: takes Beckett's DNA), "Vengeance" (3x19), "The Kindred" (4x18–4x19), "Search and Rescue" (5x01), "The Prodigal" (5x14: killed by Teyla)                                                                                                                 | The deck's second villain: an INCIDENT, or an opponent-facing ATTACK. `ALIEN` `SCIENTIST` `SHADY`.                                                                                |
| **Wraith Queens** (Andee Frizzell plays most)      | Rule the hives. Strong telepaths.                                                                                                                                                                                                                                                       | "The Hive" (2x11), "Submersion" (3x18), "Spoils of War" (4x12), "The Queen" (5x08)                                                                                                                                                                                                            | `ALIEN` `TELEPATH` (`IMPERIAL` is a stretch).                                                                                                                                     |
| **Wraith Keeper**                                  | Tends the sleeping hive in "Rising". Her death wakes them all.                                                                                                                                                                                                                          | "Rising"                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                 |
| **Steve**                                          | A captured Wraith (the team's nickname). Dies testing the Hoffan drug.                                                                                                                                                                                                                  | captured "Suspicion" (1x05), dies "Poisoning the Well" (1x07)                                                                                                                                                                                                                                 | —                                                                                                                                                                                 |
| **Asurans** (Oberoth, Niam)                        | Human-form Replicators that the Lanteans built from nanites to fight the Wraith, then abandoned. Oberoth leads them. Niam is a rogue who sides with the expedition. The team sets them against the Wraith ("Lifeline"), which backfires: they start wiping out the Wraith's human food. | "Progeny" (3x05), "The Return" (3x10–3x11: they kill the returning Ancients), "First Strike" (3x20), "Lifeline" (4x02), "The Seer" (4x08), "Be All My Sins Remember'd" (4x11: Asuras destroyed)                                                                                               | `SYNTHETIC` (nanite bodies; closer than `ANDROID`).                                                                                                                               |
| **Travelers** (Larrin, Jill Wagner)                | Humans who live aboard ships. Larrin kidnaps Sheppard, then becomes a wary ally.                                                                                                                                                                                                        | "Travelers" (4x05), "Be All My Sins Remember'd" (4x11)                                                                                                                                                                                                                                        | ALLY: `HUMAN` `PILOT` `SHADY` (or `BUSINESS`: they trade).                                                                                                                        |
| **Ancients / Lanteans**                            | The Pegasus Ancients built Atlantis and lost a long war to the Wraith. They sank the city and went back to Earth 10,000 years ago. Some returned in "The Return".                                                                                                                       | see below                                                                                                                                                                                                                                                                                     | Non-ascended: `ALIEN` (no Ancient trait). Ascended: `TRANSCENDENT`.                                                                                                               |
| Chaya Sar                                          | An ascended Ancient who protects the planet Proculus. Sheppard grows close to her.                                                                                                                                                                                                      | "Sanctuary" (1x14)                                                                                                                                                                                                                                                                            | `TRANSCENDENT`.                                                                                                                                                                   |
| Janus                                              | Lantean scientist. Helped old Weir ("Before I Sleep"). Built the time-travel jumper (SG-1 "It's Good to Be King", 8x13) and the Attero device. Has secret labs.                                                                                                                         | "First Contact" / "The Lost Tribe" (5x10–5x11)                                                                                                                                                                                                                                                | `ALIEN` `SCIENTIST` `TIME_TRAVEL`.                                                                                                                                                |
| Helia                                              | Commander of the returning Ancients. Orders the expedition out, then is killed by the Asurans.                                                                                                                                                                                          | "The Return" (3x10–3x11)                                                                                                                                                                                                                                                                      | `ALIEN` (leader).                                                                                                                                                                 |
| **Hoffans**                                        | Scientists who made a drug that makes humans poisonous to the Wraith but kills half the people who take it. Michael later turns it into a plague.                                                                                                                                       | "Poisoning the Well" (1x07), "The Kindred" (4x18–4x19), survivors in "Outsiders" (5x12)                                                                                                                                                                                                       | Hoffan drug as CARGO (§5).                                                                                                                                                        |
| **Satedans** (Tyre, Rakai, Melena)                 | Ronon's people. Sateda was destroyed about seven years before "Runner". Some survivors became Wraith worshippers.                                                                                                                                                                       | "Sateda" (3x04), "Reunion" (4x03), "Broken Ties" (5x03)                                                                                                                                                                                                                                       | `HUMAN` `SECURITY`.                                                                                                                                                               |
| **Wraith worshippers**                             | Humans who serve the Wraith for the enzyme or for protection.                                                                                                                                                                                                                           | "Reunion", "Broken Ties"                                                                                                                                                                                                                                                                      | `SHADY`.                                                                                                                                                                          |
| **The Trust / Goa'uld**                            | An SG-1 villain group. It plants a bomb in Atlantis through a possessed Caldwell.                                                                                                                                                                                                       | "Critical Mass" (2x13)                                                                                                                                                                                                                                                                        | A one-off INCIDENT idea.                                                                                                                                                          |
| **Coalition of Planets**                           | Pegasus worlds that put the expedition on trial.                                                                                                                                                                                                                                        | "Inquisition" (5x13)                                                                                                                                                                                                                                                                          | **Don't use the exact name**: it is an STCC card name (§7.3).                                                                                                                     |
| **The Ori**                                        | SG-1's season 9–10 villains. Practically absent from Atlantis.                                                                                                                                                                                                                          | —                                                                                                                                                                                                                                                                                             | Leave them out.                                                                                                                                                                   |

## 4. Locations

| Place                                                                                                                                                                                                   | What it is                                                                                                                                                                                                                                                                                                                                                                                                                     | Key episodes                                                             | Fit                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Atlantis** (the city)                                                                                                                                                                                 | Ancient city. Found underwater; it rises when the shield fails ("Rising"). The production called the gate room set the "Gatetrium". Parts of the city: the **gate room** with the **control room** and Weir's office above it; the **jumper bay** over the gate room; the **chair room** (control chair, drones, flight); the **ZPM console** with three slots; the infirmary; the piers and balconies; the **control tower**. | throughout                                                               | The deck's home. A controlled starting LOCATION fits (SIS precedent). `STARBASE` (a base) + `SCIENTIST` (Ancient labs). |
| **Janus's lab**                                                                                                                                                                                         | One of Janus's secret labs. Daniel Jackson finds it, and it leads to the Attero device. That the lab is inside the city is **unverified**.                                                                                                                                                                                                                                                                                     | "First Contact" (5x10)                                                   | A Research LOCATION or a Development card.                                                                              |
| **Lantea**                                                                                                                                                                                              | Atlantis's original planet: an ocean world.                                                                                                                                                                                                                                                                                                                                                                                    | seasons 1–3                                                              | —                                                                                                                       |
| **M35-117** ("New Lantea" on the wikis)                                                                                                                                                                 | The new ocean planet where the city lands. It has no Stargate.                                                                                                                                                                                                                                                                                                                                                                 | "Lifeline" (4x02)                                                        | The on-screen name is **unverified**.                                                                                   |
| **Athos** / the mainland / **New Athos**                                                                                                                                                                | Teyla's home. Culled in "Rising". Her people resettle on the mainland after "Suspicion", then on New Athos.                                                                                                                                                                                                                                                                                                                    | "Rising", "Suspicion", "Missing"                                         | A trading LOCATION.                                                                                                     |
| **Sateda**                                                                                                                                                                                              | Ronon's destroyed homeworld.                                                                                                                                                                                                                                                                                                                                                                                                   | "Sateda" (3x04)                                                          | —                                                                                                                       |
| **Genii homeworld**                                                                                                                                                                                     | Farms above ground; bunkers and a bomb programme underneath.                                                                                                                                                                                                                                                                                                                                                                   | "Underground" (1x08), "Coup d'Etat"                                      | `SPY`, Military.                                                                                                        |
| **Asuras**                                                                                                                                                                                              | The Asurans' homeworld; ZPM source in "Lifeline"; destroyed in 4x11.                                                                                                                                                                                                                                                                                                                                                           | "Progeny", "Lifeline", "Be All My Sins Remember'd"                       | A raid LOCATION: steal a ZPM, take an INCIDENT.                                                                         |
| **Proculus**                                                                                                                                                                                            | Chaya's protected world.                                                                                                                                                                                                                                                                                                                                                                                                       | "Sanctuary" (1x14)                                                       | —                                                                                                                       |
| **Doranda**                                                                                                                                                                                             | Site of Project Arcturus, which McKay blew up.                                                                                                                                                                                                                                                                                                                                                                                 | "Trinity" (2x06)                                                         | —                                                                                                                       |
| **Dagan**                                                                                                                                                                                               | Old Lantean outpost with a hidden ZPM.                                                                                                                                                                                                                                                                                                                                                                                         | "The Brotherhood" (1x16)                                                 | —                                                                                                                       |
| **Hoff**                                                                                                                                                                                                | The Hoffans' world.                                                                                                                                                                                                                                                                                                                                                                                                            | "Poisoning the Well" (1x07)                                              | —                                                                                                                       |
| **Taranis**                                                                                                                                                                                             | Ancient outpost under a supervolcano; the Orion's hiding place.                                                                                                                                                                                                                                                                                                                                                                | "Inferno" (2x19)                                                         | —                                                                                                                       |
| **Manaria**                                                                                                                                                                                             | Shelters the expedition from the storm.                                                                                                                                                                                                                                                                                                                                                                                        | "The Storm" (1x10)                                                       | —                                                                                                                       |
| **Olesia**                                                                                                                                                                                              | Sends its convicts to a prison island for the Wraith.                                                                                                                                                                                                                                                                                                                                                                          | "Condemned" (2x05)                                                       | —                                                                                                                       |
| **Belkan**                                                                                                                                                                                              | A trading world.                                                                                                                                                                                                                                                                                                                                                                                                               | "Trinity" (2x06)                                                         | —                                                                                                                       |
| **Midway station**                                                                                                                                                                                      | Space station halfway between the galaxies on the intergalactic gate bridge. The bridge was first tested in "The Return". Kavanagh sets off its self-destruct.                                                                                                                                                                                                                                                                 | "Midway" (4x17)                                                          | A link-to-Earth LOCATION.                                                                                               |
| **Wraith cloning facility**                                                                                                                                                                             | Powered by captured ZPMs. Teyla crashes a hive into it.                                                                                                                                                                                                                                                                                                                                                                        | "Spoils of War" (4x12)                                                   | —                                                                                                                       |
| **Michael's bases**                                                                                                                                                                                     | Hybrid labs.                                                                                                                                                                                                                                                                                                                                                                                                                   | "Vengeance" (3x19), "The Kindred", "Search and Rescue"                   | —                                                                                                                       |
| **Earth**: SGC (Cheyenne Mountain), the **Antarctic outpost** (control chair, drones, the first ZPM), San Francisco Bay (where the city lands in 5x20), Las Vegas ("Vegas", 5x19, an alternate reality) | —                                                                                                                                                                                                                                                                                                                                                                                                                              | "Rising", "Home" (1x09), "Outcast" (4x15), "Midway", "Enemy at the Gate" | The Antarctic outpost is a good "find the gene" place.                                                                  |

## 5. Items and tech

### 5.1 ZPMs (Zero Point Modules): where each one came from

A ZPM is an Ancient power source that draws energy from a pocket of subspace time. Atlantis
has three ZPM slots (Solutions wiki: "three circular niches"). Naquadah generators run daily
life; the shield, drones and flight need ZPMs.

| #    | ZPM                       | Episode                                                                                | What happened                                                                                                                                                                                    | Confidence                                  |
| ---- | ------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| 1    | The Praclarush Taonas ZPM | SG-1 "Lost City" (7x21–7x22) → "Rising"                                                | Found by SG-1 and used at the Antarctic outpost to fire drones at Anubis's fleet. The expedition takes it to dial Pegasus, which drains it.                                                      | Solutions wiki                              |
| 2–4  | Atlantis's own three      | "Rising" (1x01)                                                                        | Two completely drained and one nearly drained. Arriving drains the last; the shield fails and the city rises to the surface.                                                                     | Solutions wiki + search summary             |
| 5    | Childhood's End ZPM       | "Childhood's End" (1x06)                                                               | Powers a shield on M7G-677. McKay takes it out, and a Wraith beacon switches on. Nearly empty; left with the villagers.                                                                          | Wikipedia + Solutions wiki                  |
| —    | "Before I Sleep"          | 1x15                                                                                   | Old Weir hands over gate addresses for five possible ZPM sites.                                                                                                                                  | York review; **unverified**                 |
| 6    | Brotherhood ZPM           | "The Brotherhood" (1x16)                                                               | The team finds it on Dagan. The Genii try to take it. The natives (the Brotherhood) hide it again. Atlantis gets nothing.                                                                        | York + Solutions wiki                       |
| 7    | The "Moebius" ZPM         | SG-1 "Moebius" (8x19–8x20) → "The Siege Part 2/3"                                      | SG-1 steals it from Ra in ancient Egypt. Earth uses it to dial Atlantis and send reinforcements, then the Daedalus brings it ("The Siege Part 3", 2x01). It powers the shield against the hives. | Wikipedia + Solutions wiki                  |
| —    | Genii ZPM                 | "Coup d'Etat" (2x17)                                                                   | Ladon offers it as payment for help with his coup. It has been drained for thousands of years.                                                                                                   | Solutions wiki + Wikipedia                  |
| —    | Bridge experiment         | "McKay and Mrs. Miller" (3x08)                                                         | The city's ZPM powers a bridge to another universe. The Solutions wiki says it was drained.                                                                                                      | **unverified**                              |
| 8–10 | The Ancients' ZPMs        | "The Return" (3x10–3x11)                                                               | The returning Ancients power up the city. After the team retakes it, Atlantis has three charged ZPMs. One stays; two go to Earth (the Antarctic outpost and the Odyssey).                        | Solutions wiki; the split is **unverified** |
| —    | Drained in "Adrift"       | 4x01                                                                                   | The shield drains the city's ZPM under the Asurans' beam attack. The city is stranded in space.                                                                                                  | Wikipedia                                   |
| 11   | Stolen from Asuras        | "Lifeline" (4x02)                                                                      | The team steals a ZPM from the Asurans' homeworld, and the city lands on M35-117.                                                                                                                | Wikipedia                                   |
| —    | Wraith ZPMs               | "Spoils of War" (4x12), "Be All My Sins Remember'd" (4x11), "Enemy at the Gate" (5x20) | A Wraith cloning facility runs on captured ZPMs. A plan to detonate ZPMs on Asuras fails. The super-hive runs on ZPMs.                                                                           | Wikipedia                                   |
| —    | The flight to Earth       | "Enemy at the Gate" (5x20)                                                             | Zelenka's wormhole drive moves the city to Earth in seconds. The city ends up out of power.                                                                                                      | Wikipedia                                   |

The takeaway: at nearly every point in the show Atlantis has **one** working ZPM at most,
and losing it is a crisis.

### 5.2 Other tech

| Item                             | What it does                                                                                                                        | Episodes                                                                                                                              | Card fit                                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Control chair** and **drones** | The chair links a gene carrier to the city's (or the outpost's) weapons and systems. Drones are seeking energy weapons.             | "Rising" (Antarctic chair; Beckett's stray drone); SG-1 "Lost City"; the city's chair in "Enemy at the Gate" (Beckett flies the city) | A gene-gated ATTACK. `WEAPON`.                                                                                                                                           |
| **Personal shield**              | An Ancient wearable force field. McKay can't switch it off; Lavin later uses one.                                                   | "Hide and Seek" (1x03), "Irresponsible" (3x13)                                                                                        | Protection, e.g. ignore an attack.                                                                                                                                       |
| **ATA gene therapy**             | Gives the gene to 48 % of recipients.                                                                                               | "Hide and Seek" (1x03)                                                                                                                | Enable the gene (see the trait note in §1.1). Granting a trait to a PERSON may need checking: the DSL's temporary trait grant is only proven for a SHIP gaining `CLOAK`. |
| **Hoffan drug**                  | Makes humans poisonous to the Wraith. Kills 50 %. Michael turns it into a plague.                                                   | "Poisoning the Well" (1x07), "The Kindred" (4x18–4x19), "Outsiders" (5x12); in "The Last Man" Keller dies of it                       | A dark trade-off: protection that costs a PERSON or an INCIDENT. `DOCTOR` `WEAPON`.                                                                                      |
| **Wraith retrovirus**            | Beckett's drug to make Wraith human. Used on Ellia, then on Michael; the "Allies" plan; a whole hive turned human in "Misbegotten". | "Instinct" (2x07), "Michael" (2x18), "Allies" (2x20), "Misbegotten" (3x02)                                                            | Turn a Wraith INCIDENT into something harmless: return it. `DOCTOR`.                                                                                                     |
| **Iratus bug**                   | The Wraith's ancestor. One latches onto Sheppard's neck. The retrovirus built on it nearly turns him into one.                      | "Thirty-Eight Minutes" (1x04), "The Gift" (1x18), "Conversion" (2x08), "Vengeance" (3x19)                                             | `CREATURE`. Avoid the exact name "Iratus Bug" (§7.2).                                                                                                                    |
| **Wraith enzyme**                | Gives strength and is addictive.                                                                                                    | "The Siege Part 3", "The Lost Boys", "The Hive", "Broken Ties"                                                                        | A boost with an INCIDENT cost. `AUGMENT`/`SHADY`.                                                                                                                        |
| **Wraith stunner**               | Wraith stun guns, for taking humans alive.                                                                                          | throughout                                                                                                                            | `WEAPON`.                                                                                                                                                                |
| **Ronon's gun**                  | A revolver-like energy pistol that stuns or kills. No on-screen name; fans call it a "particle magnum" (**unverified**).            | from "Runner"                                                                                                                         | `WEAPON`. Name it descriptively, e.g. "Ronon's Blaster".                                                                                                                 |
| **Attero device**                | Janus's weapon. It destroys Wraith ships entering hyperspace but makes Stargates explode.                                           | "First Contact" / "The Lost Tribe" (5x10–5x11)                                                                                        | A powerful card with a heavy cost. `WEAPON`.                                                                                                                             |
| **Time-travel jumper**           | Janus's jumper with a time machine.                                                                                                 | SG-1 "It's Good to Be King" (8x13), "Moebius" (8x19–8x20)                                                                             | `TIME_TRAVEL` `CLOAK`. Mostly SG-1 material.                                                                                                                             |
| **Stardrive / wormhole drive**   | The city's own engines; Zelenka's wormhole drive in the finale.                                                                     | "Adrift" (4x01), "Enemy at the Gate" (5x20)                                                                                           | The "city flies" Development effect.                                                                                                                                     |
| **Project Arcturus**             | An Ancient zero-point experiment that McKay overloads.                                                                              | "Trinity" (2x06)                                                                                                                      | Huge Research for an INCIDENT.                                                                                                                                           |
| **Ancient satellite**            | Defence platform at the Lagrange point. Destroys one hive, then is lost.                                                            | "The Siege Part 1/2" (1x19–1x20)                                                                                                      | —                                                                                                                                                                        |
| **Asuran satellite weapon**      | A beam that pins the city down and disables the gate. Holding it off with the shield drains the ZPM.                                | "First Strike" (3x20), "Adrift" (4x01)                                                                                                | An INCIDENT.                                                                                                                                                             |
| **Ascension machine**            | Makes McKay superhuman.                                                                                                             | "Tao of Rodney" (3x14)                                                                                                                | —                                                                                                                                                                        |
| **Stasis pods**                  | Old Weir's 10,000-year sleep; the Aurora's crew; Beckett's clone.                                                                   | "Before I Sleep", "Aurora", "The Kindred"                                                                                             | —                                                                                                                                                                        |
| **Keller's Wraith gene therapy** | Frees the Wraith from feeding; the basis of the deal with Todd.                                                                     | "The Queen" (5x08), "Infection" (5x17)                                                                                                | An ALLY bargain.                                                                                                                                                         |

## 6. Recurring themes, and engine/risk candidates

### 6.1 Themes and how they fit the game

| Theme                                          | In the show                                                                                                                                                                      | Fit with the game's mechanics                                                                                                                                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scarce power (ZPMs)**                        | Every big feat needs a ZPM; there is almost never a spare.                                                                                                                       | **Strong.** {DIL} is power (naquadah for small turns, a ZPM for a burst). A ZPM is a CARGO you spend (discard or log) for one big turn: lots of {DIL}, a warp and beam, a Research jump, or the city's drones/shield. Scarcity keeps the count low. |
| **The Wraith: culling and feeding**            | The constant threat. Darts cull people, hives besiege.                                                                                                                           | **Strong**, as the risk: Wraith INCIDENTs (culling, hive ship, dart), effects that remove Away Teams or beamed PERSONs, and the Burn as the loss.                                                                                                   |
| **Blowback from the expedition's own actions** | They wake the Wraith ("Rising"), pulling a ZPM switches on a Wraith beacon ("Childhood's End"), Arcturus ("Trinity"), Ford, Michael, the Asurans set on the Wraith ("Lifeline"). | **Strong** as the link between engine and risk: power and meddling bring trouble.                                                                                                                                                                   |
| **Gene-gated Ancient tech**                    | Jumpers, chairs, drones and pods need a carrier. Carriers are few and get kidnapped.                                                                                             | **Good** as a condition ("if you have an `AUGMENT` in play / on this SHIP"). A gate is a constraint, not an economy, so it suits texture better than the engine.                                                                                    |
| **Trading and alliances with Pegasus peoples** | Teyla's trading partners, the Athosians, the Travelers, uneasy Genii and Wraith deals.                                                                                           | **Good** for Influence, {LAT} and ALLYs. Fickle allies need a cost hook (INCIDENTs), since cards can't change sides.                                                                                                                                |
| **Cut off from Earth**                         | Season 1 isolation; the Daedalus (season 2) and Midway restore the link; the IOA meddles from afar.                                                                              | **Medium.** It is an arc, not a risk: the starting deck is self-reliant, and the Daedalus arrives from the Reserve.                                                                                                                                 |
| **Enemy of my enemy**                          | Todd, Michael's "Allies", Larrin.                                                                                                                                                | **Good** for one or two ALLY cards that return or exchange INCIDENTs.                                                                                                                                                                               |

### 6.2 Candidate "one engine, one risk" pairs

**A. Power and the Wraith (recommended).**

- **Engine:** ZPM power. A few ZPM CARGO cards are used up for big turns. The city
  (LOCATION) and the Jumper unlock their best effects when a ZPM is spent.
- **Risk:** the Wraith. The big turns and the meddling pay in Wraith INCIDENTs (culling,
  hive ships), and the Burn ends the game.
- **What keeps it going:** crew who return or neutralise INCIDENTs: Beckett or Keller (the
  retrovirus, medicine), Teyla (senses the Wraith), Todd (a deal).
- **How it differs from MAL:** MAL profits from taking INCIDENTs. Atlantis should pay
  INCIDENTs as the price of power and spend effort cleaning them up. Don't copy MAL's
  "INCIDENT → reward" reactions. The show backs this up: each power grab brings the Wraith
  (§6.1, blowback).

**B. The gene and the gate.**

- **Engine:** gene-gated Ancient tech. The Jumper, the chair/drones, the personal shield and
  stasis pods have strong effects that need an `AUGMENT` (gene carrier) aboard, as Duty
  Officer or in the Away Team. Gene therapy is the way to get one. Carriers: Sheppard,
  Beckett, McKay, Lorne.
- **Risk:** the Wraith cull your people. INCIDENTs and attacks that dismiss beamed PERSONs or
  remove Away Teams shut the tech down. Kidnappers (the Genii in "Coup d'Etat", the Travelers)
  add flavour.
- **Weakness:** a trait gate alone is thin as an engine. It's best layered under pair A.

**C. Pegasus diplomacy.**

- **Engine:** trade and alliances. Influence and {LAT} through Teyla, the Athosians and the
  Travelers, Weir's and Woolsey's diplomacy, and ALLYs.
- **Risk:** dangerous friends. ALLYs (the Genii, Michael's faction, Todd) cost INCIDENTs or
  hand the opponent an edge.
- **Weakness:** the risk again lands on INCIDENT costs, so it overlaps MAL. The engine is
  also less distinctive: Influence decks already exist in box 1.

**Supporting ideas the show offers, whatever pair is chosen:**

- A board mission for the AR-1 gate team: a `PILOT`, a `SCIENTIST`, a `TELEPATH` and a
  `SECURITY` on one SHIP (Sheppard, McKay, Teyla, Ronon). This sits close to MAL's
  `TELEPATH`/`DOCTOR`/`PILOT` mission, so make it differ.
- The Daedalus as the Reserve SHIP that arrives mid-game, carrying a ZPM.
- Tracks: Research (McKay, Zelenka, Carter, Keller), Influence (Weir, Teyla, Woolsey),
  Military (Sheppard, Ronon, Lorne, Caldwell).

### 6.3 Trait supply in the common market

Counted over the card definitions in `src/data/cards/common/` (definitions, not copies):

| Trait                                                            | Common defs |
| ---------------------------------------------------------------- | ----------- |
| `SHADY`                                                          | 11          |
| `SCIENTIST`, `ALIEN`, `BUSINESS`, `ANOMALY`                      | 8 each      |
| `ENGINEER`                                                       | 6           |
| `DOCTOR`, `AMBASSADOR`, `WEAPON`, `TIME_TRAVEL`, `COMMUNICATION` | 5 each      |
| `TELEPATH`, `SYNTHETIC`, `TRANSCENDENT`, `STARBASE`              | 4 each      |
| `AUGMENT`, `PILOT`, `SECURITY`                                   | **1 each**  |

So a deck that keys on `AUGMENT`, `PILOT` or `SECURITY` must supply them itself. Keying on
`SCIENTIST` or `ALIEN` lets the market feed it.

## 7. Pitfalls

### 7.1 Facts people get wrong

- **The Stargate TCG was not a Sabertooth Games product.** Sony Online Entertainment designed
  it (and ran the online version), and Comic Images published the paper cards (2007–2008).
  The sets were "Stargate: SG-1", "System Lords" and "Rise of the Ori". A "Set 4: Atlantis"
  was announced and **cancelled**. Atlantis content is a handful of character cards and
  promos.
- **Sheppard is not the expedition leader.** Weir is, then Carter, then Woolsey. His rank is
  Major, then Lieutenant Colonel from "The Intruder" (2x02).
- **48 % vs 50 %.** The gene therapy works in 48 % of cases. The Hoffan drug kills 50 %.
- **Kolya dies in "Irresponsible" (3x13)**, shot by Sheppard, not in "Common Ground" (3x07).
  A Kolya shows up again in "Remnants" (5x15), but he is an alien projection.
- **Ford doesn't die on screen.** He is last seen as a hive explodes ("The Hive", 2x11).
- **Teyla has Wraith DNA, not the ATA gene.** Zelenka's therapy failed.
- **ZPM count:** one working ZPM most of the time, not a stockpile (§5.1). The "Moebius" ZPM
  came from SG-1 via the Daedalus. The "Lifeline" ZPM was stolen from the Asurans.
- **The city flies rarely**: 4x01–4x02 and 5x20. "Rising" is the city _surfacing_, not flying.
- **"Asurans" vs "Replicators":** Wikipedia's season pages say "Replicators". On screen the
  Pegasus ones are the Asurans, built by the Lanteans. They are different from SG-1's
  bug-like Replicators.
- **The Orion's original name** was _Hippaforalkus_. It was found in "Inferno" (2x19) and
  destroyed in "No Man's Land" (3x01).
- **Keller's first appearance** is "First Strike" (3x20). Jewel Staite's earlier role was
  Ellia ("Instinct", 2x07).
- **One actor, two roles:** Christopher Heyerdahl plays both Halling and Todd. This matters
  when choosing art.
- **Todd's name:** a nickname given by the team; first used on screen in "Spoils of War"
  (4x12) per IMDb trivia (**unverified**). The name "Guide" comes from tie-in material
  (**unverified**). Don't treat it as on-screen canon.
- **The Keeper/Sumner scene** in "Rising" is told two ways (§1.2).
- **"Gatetrium"** is a production name for the gate room set, not an on-screen term.

### 7.2 Names owned by other products

Character, ship and place names from the show are fine. What to avoid is other products'
**invented** titles and subtitles, and taglines.

**Stargate TCG (SOE / Comic Images, 2007–2008):**

- **ZPM cards:** "Recover Z.P.M." (a mission) and "Booby-Trapped Z.P.M." (an obstacle).
- **Shared with show terms:** "Search and Rescue" (a mission, and also the SGA 5x01 episode
  title), "Repository of Knowledge" (gear), "Iratus Bug" (Set-4 promo 4P1).
- **Close to Atlantis ideas:** "Ancient Contagion", "Time Dilation", "Escape Time Dilation
  Field", "Advanced Technology", "Excavate Ancient Artifacts", "Investigate Ancient
  Inscriptions", "Power Surge", "Lockdown", "Out of Phase", "Genetic Manipulations",
  "Anti-Replicator Disruptor", "Withstand Armada", "Teeming Numbers", "Approaching Swarm",
  "Relentless Pursuit", "Hot Pursuit", "Evacuate Village", "Aid Evacuation", "Protect
  Village", "Trial by Fire", "Cut Off", "Sabotage".
- **Character subtitles** (don't reuse as our subtitles or flavor): Sheppard, "Unconventional
  Leader"; Weir, "Skilled Diplomat" and "Ancient Languages Expert"; McKay, "Stargate Expert"
  and "Munitions Yield Expert"; Woolsey, "Washington Bureaucrat"; Sumner, "Senior Military
  Officer"; Hermiod, "Engineering Specialist"; Novak, "Eccentric Engineer"; Ayiana, "Remnant
  of Atlantis"; Carolyn Lam, "Chief Medical Officer"; Merlin, "Dissenting Ancient"; Morgan Le
  Fay, "Dissident Ancient".
- **Its vocabulary:** card types Mission, Obstacle, Adversary, Gear, Event; skills Culture,
  Science, Combat, Ingenuity; Debrief. Our game has its own terms, so this is only a caution
  against mirroring them.

**Rittenhouse trading cards (collectible, not a game):**

- The season 1 "Ancient Technologies" insert set has cards titled Puddle Jumper, Personal
  Shield, Zero Point Modules, Cryogenic Chamber/Stasis Unit, Defense Drones, Lagrange Point
  Satellite, Command Chair and Repository of Knowledge.
- The seasons 3–4 "Pegasus Galaxy Starships" set has Wraith Hiveship, Wraith Cruiser,
  Ancient Battleship, Asuran Attack Vessel and "Deadalus" [sic].
- Other set names: "Atlantis Crew", "Atlantis Team", "Warriors in Action", "The Quotable
  Stargate Atlantis", "Fallen Hero".
- Using the show's own nouns for the same objects (Puddle Jumper, ZPM, Daedalus) is
  unavoidable and fine. Avoid the invented phrasings and the set names. Say "control chair"
  rather than "Command Chair", and pick your own wording for drones, hive ships and so on.

**Taglines and titles:**

- The show's tagline is "A new gate will open. A lost city will rise again." Don't echo "lost
  city … rise again" or "a new gate will open" in flavor.
- **"Rising":** the pilot's title, and also the first Fandemonium novel (SGA-1). Avoid it as
  a card name.
- **Novels:** Reliquary, The Chosen, Halcyon, Exogenesis, Entanglement, Casualties of War,
  Blood Ties, Mirror Mirror, Nightfall, Angelus, Dead End, Hunt and Run, Death Game,
  Brimstone.
- **Legacy novel series:** Homecoming, The Lost, Allegiance, The Furies, Secrets, The
  Inheritors, Unascended, Third Path, Pride of the Genii.
- **SGX novellas:** Far Horizons, Points of Origin, Lost Queen, Wild Blue, Homeworlds, Behind
  Enemy Lines, From the Depths.
- **Big Finish audio:** A Necessary Evil, Perchance to Dream, Zero Point, Impressions, The
  Kindness of Strangers, Meltdown.
- **Comics:**
  - Avatar Press, "Wraithfall": the comic's name for a culling ritual, so avoid it for a
    culling card. Plain "Culling" turned up no product title.
  - American Mythology: "Back to Pegasus", "Gateways", "Hearts & Minds", "Singularity".
- **Games:**
  - Video games: Stargate Worlds (its planned "Atlantis Expansion"), Stargate Resistance,
    Stargate: Timekeepers, Stargate SG-1: Unleashed, Stargate Command.
  - RPGs: AEG's _Stargate SG-1_ RPG books (Fantastic Frontiers, Friends and Foes, Living Gods,
    First Steps) and Wyvern's _Stargate SG-1_ RPG ("Phoenix Site", "Stargate: Phoenix").
    "Phoenix" is also the BC-304's earlier name; call that ship George Hammond.
  - Board games: Stargate SG-1 (Fleet Games, 2004), Stargate Missions (Warp Spawn, 2005;
    decks Personnel/Missions/Events).

### 7.3 Collisions with Star Trek: Captain's Chair names (our own audit)

- `tools/audit-publish.ts` scans the pack file (`src/data/custom/<pack>.json` is under `src/`)
  for STCC card names. I ran its matching rules over about 300 Atlantis names, terms and all
  100 episode titles.
- **"Coalition of Planets"** (the "Inquisition" tribunal) is an STCC card name, and the audit
  **would fail** on it. Call it "the Coalition" or similar.
- **"First Contact"** (SGA 5x10) and **"Orion"** (the Ancient warship) are STCC card names.
  The audit lets them through: "first contact" is on its plain-English list, and ORION is a
  trait. Still, avoid "First Contact" as a card name. "Orion" will read like the Trek species
  or the STCC location, so consider "the Orion" with care.
- STCC's directive names (Recruit, Utilize, Analyze, Red Alert) are allowed but should be
  renamed, as MAL did.
- Nothing else collided: no character, ship, place or other episode title.

### 7.4 Quotes and music

- The theme music has no lyrics.
- Keep any quote to a short catchphrase. Short, safe lines: "Puddle Jumper" (the naming
  joke), the Keeper's dying "you've awoken them all" (paraphrase it), Teyla's formal
  "daughter of Tagan".
- Too long to use: the hologram's history lecture in "Rising", Woolsey's defence speech in
  "Inquisition", and any long exchange (Sheppard and McKay banter, the Kolya negotiations).
- Zelenka's lines are often ad-libbed Czech, sometimes profanity. Don't quote them.

## 8. Image leads (TMDB)

- **TMDB ids:**
  - _Stargate Atlantis_: **tv/2290** (`https://www.themoviedb.org/tv/2290`).
  - _Stargate SG-1_: tv/4629, for Carter, Woolsey, Lorne, O'Neill and the BC-304s.
  - _Stargate Universe_: tv/5148.
  - _Stargate: Continuum_: movie/12914.
- **URL patterns that worked:**
  - Episode stills: `/tv/2290/season/S/episode/E/images/backdrops`.
  - Show-level images: `/tv/2290/images/backdrops` and `/images/posters`.
  - Season posters: `/tv/2290/season/S/images/posters`.
  - Fetch with `curl`, a browser User-Agent and a few seconds between requests. No bot check
    was hit across 118 requests.
- **Language filter:** each images page opens filtered to one language. Add
  `?image_language=xx` for textless images. The show has **35 textless backdrops**
  (1920×1080, two at 4K), the likeliest key art and cast promos.
- **Season posters:** 18/17/16/16/18 per season. They are mostly English, with titles on them.
- **Stills are uneven:**
  - Seasons 1–2 have 138 and 141 stills.
  - Seasons 3–5 have only 49, 50 and 41: one to three per episode.
  - Richest episodes: "Rising" (23 + 16), "Condemned" (18), "Trinity" (18), "Duet" (17),
    "The Intruder" (17), "Runner" (11), "The Siege Part 2" (10), "Before I Sleep" (9).
- **No captions:** TMDB never says who is in a still. Check each one on a contact sheet (§6
  of the playbook).
- **No actor photos:** the TMDB person ids below are for cross-reference only. Art must come
  from series stills.

Per subject, the episodes most likely to hold good solo, front-facing stills (still counts in
brackets; character-focused episodes first):

| Subject                       | Episodes (TMDB stills)                                                                                               | Note                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Sheppard                      | 1x01 Rising (23), 1x02 (16), 2x02 The Intruder (17), 2x05 Condemned (18), 2x08 Conversion (2), 4x20 The Last Man (3) | also show textless backdrops           |
| Weir                          | 1x15 Before I Sleep (9), 1x01 (23), 2x16 The Long Goodbye (5), 1x11 The Eye (3)                                      | Before I Sleep also has old Weir       |
| McKay                         | 2x04 Duet (17), 2x06 Trinity (18), 1x03 Hide and Seek (2), 2x14 Grace Under Pressure (4)                             |                                        |
| Teyla                         | 1x18 The Gift (7), 1x01–1x02, 1x05 Suspicion (6), 5x08 The Queen (2)                                                 |                                        |
| Ronon                         | 2x03 Runner (11), 2x05 Condemned (18), 2x06 Trinity (18), 3x04 Sateda (2)                                            | Runner is his debut                    |
| Ford                          | 2x02 The Intruder (17), 1x01–1x02, 2x10 The Lost Boys (4), 2x11 The Hive (4)                                         | enzyme look in 2x10–2x11               |
| Beckett                       | 1x07 Poisoning the Well (3), 1x01 (23), 2x18 Michael (4), 3x17 Sunday (3)                                            |                                        |
| Zelenka                       | 1x04 Thirty-Eight Minutes (5), 1x10 The Storm (4), 1x13 Hot Zone (5), 2x06 Trinity (18)                              |                                        |
| Lorne                         | 3x15 The Game (2), 3x17 Sunday (3), 3x01 No Man's Land (4)                                                           | or SG-1 tv/4629 "Enemy Mine" (7x07)    |
| Keller                        | 4x07 Missing (3), 4x16 Trio (3), 5x09 Tracker (3), 4x13 Quarantine (3)                                               | few stills; check textless backdrops   |
| Carter                        | 4x03 Reunion (3), 4x16 Trio (3), 4x01 Adrift (3)                                                                     | SG-1 tv/4629 has far more              |
| Woolsey                       | 5x15 Remnants (3), 5x13 Inquisition (2), 3x10 The Return (5)                                                         | SG-1 tv/4629 too                       |
| Caldwell                      | 2x01 The Siege Part 3 (8), 2x02 The Intruder (17), 2x13 Critical Mass (3)                                            |                                        |
| Todd                          | 3x07 Common Ground (2), 4x12 Spoils of War (3), 5x08 The Queen (2), 5x10 First Contact (2)                           | Heyerdahl also plays Halling           |
| Michael                       | 2x18 Michael (4), 3x19 Vengeance (3), 4x19 The Kindred Part 2 (3), 5x14 The Prodigal (2)                             |                                        |
| Kolya                         | 1x16 The Brotherhood (8), 1x10 The Storm (4), 1x11 The Eye (3), 3x13 Irresponsible (2)                               |                                        |
| Ladon Radim                   | 2x17 Coup d'Etat (3)                                                                                                 |                                        |
| Larrin                        | 4x05 Travelers (3), 4x11 Be All My Sins Remember'd (2)                                                               |                                        |
| Wraith Queen                  | 2x11 The Hive (4), 4x12 Spoils of War (3), 3x18 Submersion (2)                                                       |                                        |
| Wraith Keeper / hive interior | 1x01–1x02 Rising (23/16)                                                                                             |                                        |
| Halling, Athosians            | 1x01–1x02, 1x05 Suspicion (6)                                                                                        |                                        |
| Genii                         | 1x08 Underground (5)                                                                                                 |                                        |
| Hoffans                       | 1x07 Poisoning the Well (3)                                                                                          |                                        |
| Asurans (Oberoth, Niam)       | 3x05 Progeny (3), 3x10 The Return (5), 4x02 Lifeline (2)                                                             |                                        |
| Chaya Sar                     | 1x14 Sanctuary (6)                                                                                                   |                                        |
| Puddle Jumper                 | 1x04 Thirty-Eight Minutes (5), 1x01–1x02, 1x20 The Siege Part 2 (10), 2x14 Grace Under Pressure (4)                  |                                        |
| Atlantis (city)               | show textless backdrops (35), 1x01–1x02, 4x01 Adrift (3), 5x20 Enemy at the Gate (2)                                 |                                        |
| Daedalus                      | 2x01 The Siege Part 3 (8), 2x02 The Intruder (17), 5x04 The Daedalus Variations (2)                                  |                                        |
| Orion                         | 2x19 Inferno (3), 3x01 No Man's Land (4)                                                                             |                                        |
| Aurora                        | 2x09 Aurora (3)                                                                                                      |                                        |
| Hive ships / darts            | 1x01–1x02, 1x20 (10), 2x01 (8), 3x01 (4), 2x04 Duet (17, darts)                                                      |                                        |
| Antarctic outpost / chair     | 1x01 Rising (23)                                                                                                     |                                        |
| ZPM, shield, drones           | 1x06 Childhood's End (5), 1x03 Hide and Seek (2), 1x16 The Brotherhood (8)                                           | props: `likeness: false` may be better |

TMDB person ids (cross-reference only):

| Actor                 | Role                      | TMDB id | Credited episodes |
| --------------------- | ------------------------- | ------- | ----------------- |
| Joe Flanigan          | Sheppard                  | 26066   | 100               |
| Torri Higginson       | Weir                      | 5480    | 64                |
| David Hewlett         | McKay                     | 5892    | 100               |
| Rachel Luttrell       | Teyla                     | 26067   | 100               |
| Jason Momoa           | Ronon                     | 117642  | 80                |
| Rainbow Sun Francks   | Ford                      | 1196455 | 25                |
| Paul McGillion        | Beckett                   | 26069   | 63                |
| David Nykl            | Zelenka                   | 53324   | 54                |
| Kavan Smith           | Lorne                     | 21213   | 29                |
| Jewel Staite          | Keller (and Ellia, once)  | 72092   | 32                |
| Amanda Tapping        | Carter                    | 26087   | 25                |
| Robert Picardo        | Woolsey                   | 16180   | 26                |
| Mitch Pileggi         | Caldwell                  | 12644   | 22                |
| Christopher Heyerdahl | Todd and Halling          | 32887   | —                 |
| Connor Trinneer       | Michael                   | 105829  | 10                |
| Robert Davi           | Kolya                     | 2055    | 6                 |
| Ryan Robbins          | Ladon                     | 77164   | 5                 |
| Jill Wagner           | Larrin                    | 82943   | 2                 |
| Andee Frizzell        | Wraith Queens, the Keeper | 1230692 | 9                 |
| Kate Hewlett          | Jeannie Miller            | 73204   | 4                 |

## Sources

- Wikipedia:
  - Season articles: [season 1](https://en.wikipedia.org/wiki/Stargate_Atlantis_season_1),
    [season 2](https://en.wikipedia.org/wiki/Stargate_Atlantis_season_2),
    [season 3](https://en.wikipedia.org/wiki/Stargate_Atlantis_season_3),
    [season 4](https://en.wikipedia.org/wiki/Stargate_Atlantis_season_4),
    [season 5](https://en.wikipedia.org/wiki/Stargate_Atlantis_season_5).
  - Character articles: [John Sheppard](<https://en.wikipedia.org/wiki/John_Sheppard_(Stargate)>),
    [Rodney McKay](https://en.wikipedia.org/wiki/Rodney_McKay),
    [Carson Beckett](https://en.wikipedia.org/wiki/Carson_Beckett),
    [Radek Zelenka](https://en.wikipedia.org/wiki/Radek_Zelenka),
    [Elizabeth Weir](<https://en.wikipedia.org/wiki/Elizabeth_Weir_(Stargate)>),
    [Teyla Emmagan](https://en.wikipedia.org/wiki/Teyla_Emmagan),
    [Ronon Dex](https://en.wikipedia.org/wiki/Ronon_Dex),
    [Jennifer Keller](https://en.wikipedia.org/wiki/Jennifer_Keller),
    [Richard Woolsey](https://en.wikipedia.org/wiki/Richard_Woolsey),
    [Samantha Carter](https://en.wikipedia.org/wiki/Samantha_Carter).
  - Other articles: [the Wraith section of the character list](<https://en.wikipedia.org/wiki/Wraith_(Stargate)>),
    [Rising](<https://en.wikipedia.org/wiki/Rising_(Stargate_Atlantis)>),
    [Atlantis](<https://en.wikipedia.org/wiki/Atlantis_(Stargate)>),
    [List of Stargate literature](https://en.wikipedia.org/wiki/List_of_Stargate_literature),
    [List of Stargate audiobooks](https://en.wikipedia.org/wiki/List_of_Stargate_audiobooks),
    [Stargate comics](https://en.wikipedia.org/wiki/Stargate_comics),
    [List of Stargate games](https://en.wikipedia.org/wiki/List_of_Stargate_games).
- Stargate SG-1 Solutions wiki:
  - [ZPM](https://stargate-sg1-solutions.com/wiki/ZPM)
  - [Daedalus](https://stargate-sg1-solutions.com/wiki/Daedalus)
  - [John Sheppard](https://stargate-sg1-solutions.com/wiki/John_Sheppard)
  - [Evan Lorne](https://stargate-sg1-solutions.com/wiki/Evan_Lorne)
  - [Aiden Ford](https://stargate-sg1-solutions.com/wiki/Aiden_Ford)
  - Episode guides for 1x03, 2x01 and 3x07.
- [York episode reviews, season 1](https://www-users.york.ac.uk/~ss44/sf/tv/stargate/a1.htm)
- [RDA lexicon: Ancient gene](https://rdanderson.com/stargate/lexicon/entries/ancientgene.htm)
- Stargate TCG:
  - Card lists: [retrotcg.net](https://retrotcg.net/games/stargate-tcg)
  - [SOE press release (2007)](https://sony.mediaroom.com/2007-04-27-STARGATE-Online-Trading-Card-Game-Now-Available)
  - [GateWorld news (2005)](https://www.gateworld.net/news/2005/08/comic-images-to-create-stargate-card-game/)
    on Comic Images
- Rittenhouse checklists: [nslists.com](https://nslists.com/sgatlan.htm),
  [scifihobby.com](https://www.scifihobby.com/products/checklist.cfm?SetID=143)
- Episode-guide search results (Orion/Hippaforalkus, M35-117, "Common Ground" life restored,
  "Gateship One"). These come from GateWorld and Fandom snippets via web search; the pages
  themselves were not fetched.
- TMDB: [tv/2290](https://www.themoviedb.org/tv/2290) (episode stills and cast pages, fetched
  as HTML only).
