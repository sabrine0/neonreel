/** Ready-made stories in the script format (see script.ts), offered as starting points. */
export interface ExampleStory {
  id: string;
  name: string;
  /** One line shown under the picker. */
  about: string;
  script: string;
}

export const EXAMPLES: ExampleStory[] = [
  {
    id: "robot",
    name: "The robot and the plant (3 scenes)",
    about: "A quick first test: about 6 minutes to render.",
    script: `Title: Robot and the Plant
Character: a small round red robot with one big blue glowing eye, two short arms and tank treads
Style: Pixar-style 3D animation, soft warm light, cinematic
1. The robot wakes up among rusty scrap piles in a desert junkyard at sunrise, looking around || One morning, a little robot woke up alone.
2. The robot holds a tiny green plant in a rusty can while crossing a ruined city street under grey storm clouds || It found something worth protecting.
3. The robot plants the tiny green plant in the soil of a lush green valley beside a river at sunset || And carried it all the way home.`,
  },
  {
    id: "lighthouse",
    name: "The lighthouse keeper (6 scenes)",
    about: "One character, narration only. About 15 minutes.",
    script: `Title: The Last Light
Character: an old lighthouse keeper with a white beard, a navy wool sweater and a yellow raincoat
Style: moody cinematic photography, cold blue dusk light, film grain
1. ~ A lonely white lighthouse on a black basalt cliff above a stormy sea at dusk, waves exploding on the rocks || For forty years, one light kept the ships from the rocks.
2. The old lighthouse keeper climbs a narrow spiral staircase inside the tower carrying a brass oil lantern || Every evening he climbed the same two hundred steps.
3. The old lighthouse keeper polishes a huge glass lens at the top of the tower, his face lit by its glow || He: She has never failed me. Not one night.
4. ~ A small fishing boat struggling through huge dark waves at night in heavy rain, a distant beam of light sweeping across the water || That night the storm came for the fishing fleet.
5. The old lighthouse keeper stands at the rain-lashed window gripping the rail, staring out at the sea, the great lamp blazing behind him || He: Come on. Follow the light. Come home.
6. The old lighthouse keeper stands on the cliff at sunrise watching small boats resting safely in a calm harbour below || By morning, every boat had come home.`,
  },
  {
    id: "love",
    name: "The Last Spring, a love story (20 scenes)",
    about: "A couple, dialogue in two voices, a child at the end. About 50 minutes.",
    script: `Title: The Last Spring
Character: a young man with short dark hair, round glasses and a long grey coat, and a young woman with long auburn hair and a dark green dress, standing side by side
Style: cinematic 35mm film, soft natural light, muted colours
1. ~ Wide view of an empty quarantined city at dawn, deserted streets, shuttered shops, yellow warning tape across the road, fog between the buildings || The sickness took the world one city at a time.
2. The young man in the long grey coat and the young woman in the dark green dress notice each other from opposite sides of an empty street, standing still a few metres apart || He: You are the first person I have seen. She: Then stay.
3. The couple sit on a rooftop at sunset sharing a tin of food, the silent city spread out below them, both laughing || They had nothing left. So they shared it.
4. The couple walk through an abandoned library, sunlight through tall dusty windows, she pulls a book from a shelf and shows it to him || She: Read to me. He: Every night, if you let me.
5. The couple dance slowly in an empty street at night under a single working street lamp, light rain falling || In a dying city, they fell in love.
6. Close view of the couple sitting on a park bench among bare trees, foreheads touching, eyes closed || He: I am afraid of losing you. She: Then do not let go.
7. The couple stand facing each other holding hands at the altar of an empty old church, candles burning, light through stained glass windows || They married with no one watching but the candles.
8. The couple in a small warm apartment kitchen, she holds his hand against her belly, both smiling with tears in their eyes || She: We are having a child. He: Then we have a reason.
9. The couple paint a small wooden cradle together in a sunlit room, paint on their hands, both smiling || For a while, they forgot the world outside.
10. The young woman, visibly pregnant, sits by a window wrapped in a blanket, pale and tired, the young man kneels beside her holding a cup of tea || She: I am sick. I feel it. He: I know. So am I.
11. The couple lie side by side on a bed in a dim room, pale and weak, holding hands, a calendar on the wall with days crossed out || They made one promise. To last until the baby came.
12. The couple walk slowly down an empty hospital corridor, he supports her with his arm, both pale, harsh white light || He: Just a little longer. She: For her.
13. The young woman lies in a hospital bed holding a newborn baby wrapped in a white blanket, the young man leans over them both, exhausted and smiling || A daughter. Healthy. Untouched by the sickness.
14. Close view of the couple looking down at the sleeping newborn baby in the woman's arms, soft morning light || She: She has your eyes. He: And your courage.
15. The couple rest in two hospital beds pushed together, eyes closed, peaceful faces, their hands joined between the beds, a cradle beside them in dawn light || They kept their promise. Then they left together, hand in hand.
16. ~ A nurse in a protective suit gently lifts a newborn baby from a cradle in a quiet hospital room at dawn || The child lived. No one understood why.
17. ~ A seven year old girl with auburn hair and round glasses stands alone in a field of wild flowers outside a ruined city, wind in her hair || She grew up in a world the sickness could not finish.
18. ~ A seven year old girl with auburn hair and round glasses sits on a chair in a bright modern laboratory while a doctor in a white coat holds a small vial beside her arm || Child: Will it help them? Narrator: It would help everyone.
19. ~ Close view of a scientist's gloved hand holding a small glass vial of blood up to the light in a laboratory, screens glowing behind || In her blood was the cure her parents never knew.
20. ~ A seven year old girl with auburn hair and round glasses stands at a laboratory window at sunrise holding an old photograph of a young couple, a living city with people in the streets below || Child: I never met them. But they saved us all.`,
  },
];
