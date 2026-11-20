/** Editable constants. Change the thesis wording here; nothing else needs to move. */
export const site = {
  name: 'Anuraag Punnam',
  thesis: 'I build adaptive systems for signals that drift.',
  role: 'Student at San José State University',
  description:
    'Anuraag Punnam builds adaptive systems for signals that drift: EMG drift detection, compressed neural decoders on embedded hardware, and verified model routing.',
  github: 'https://github.com/ARP-source',
  // TODO(anuraag): add an email address and LinkedIn URL for the contact section.
  email: '',
  linkedin: '',
  // TODO(anuraag): set once the Vercel domain is chosen; used for canonical URLs and OG tags.
  url: '',
} as const;

export type Audience = 'neuro' | 'swe';

/** One content collection, three orderings. */
export const orderings: Record<'home' | Audience, string[]> = {
  home: ['myocopilot', 'edge-decoder-drift', 'downshift', 'warden', 'sentinel-or'],
  neuro: ['myocopilot', 'edge-decoder-drift', 'sentinel-or', 'downshift', 'warden'],
  swe: ['downshift', 'warden', 'sentinel-or', 'myocopilot', 'edge-decoder-drift'],
};

export const intros: Record<'home' | Audience, string> = {
  home:
    "Right now I'm compressing an intracortical BCI decoder to run on a Jetson Orin Nano and testing whether it can still recalibrate once the signal drifts. I also built MyoCopilot, a myoelectric controller that asks for a few fresh samples when the EMG starts to drift.",
  neuro:
    'Most of my work is about what happens to a decoder after the lab: electrodes get re-seated, the signal shifts between sessions, and accuracy drops without anyone noticing.',
  swe: 'On the software side I build things that check their own output. Downshift starts on the cheapest model and only escalates when an answer fails a check. Warden attacks an AI agent’s tool permissions, patches what it finds, and re-runs normal behaviour to prove nothing broke.',
};
