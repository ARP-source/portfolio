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
  home: 'Myoelectric control, neural decoders on the edge, and the software that keeps them honest.',
  neuro:
    'For neurotech and prosthetics teams: I work on what happens to decoders after the lab, when electrodes shift and signals drift.',
  swe: 'For software teams: I build systems that measure themselves, and I delete parts that fail validation.',
};
