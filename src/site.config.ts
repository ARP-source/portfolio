/** Editable constants. Change the thesis wording here; nothing else needs to move. */
export const site = {
  name: 'Anuraag Punnam',
  thesis: 'I build adaptive systems for signals that drift.',
  role: 'Student at San José State University',
  description:
    'Anuraag Punnam builds adaptive systems for signals that drift, from EMG drift detection to compressed neural decoders on embedded hardware and verified model routing.',
  github: 'https://github.com/ARP-source',
  email: 'anuraag.punnam@sjsu.edu',
  linkedin: 'https://www.linkedin.com/in/anuraag-punnam-3219a2281/',
  // The site's address, for canonical URLs and link previews.
  url: 'https://anuraagp.vercel.app',
} as const;

export type Audience = 'neuro' | 'swe';

/** One content collection, three orderings. */
export const orderings: Record<'home' | Audience, string[]> = {
  home: ['myocopilot', 'edge-decoder-drift', 'downshift', 'warden', 'sentinel-or'],
  neuro: ['myocopilot', 'edge-decoder-drift', 'sentinel-or', 'downshift', 'warden'],
  swe: ['downshift', 'warden', 'sentinel-or', 'myocopilot', 'edge-decoder-drift'],
};

export const intros: Record<'home' | Audience, string> = {
  home: "Right now that means shrinking an intracortical BCI decoder to run on a Jetson Orin Nano, and checking whether it can still recalibrate on the device once the signal moves.",
  neuro:
    "Right now that means shrinking an intracortical BCI decoder to run on a Jetson Orin Nano, and checking whether it can still recalibrate on the device once the signal moves. The EMG projects below are about the same problem in the forearm.",
  swe: "A lot of that is plain software work, like services that check their own output, eval loops, and dashboards that tell you when a model has stopped doing its job. The projects below are ordered with that in mind.",
};
