// Learner-facing copy, exactly as in spec section 5.3. Do not edit after the freeze line.

export const copy = {
  'start.title': 'Bun venit la quizul Punctul IT!',
  'start.info':
    'Durează cam 30 de minute. Răspunzi cu cuvintele tale la câteva întrebări despre tehnologie. Nu e un test și nu primești note. Răspunsurile ne ajută să construim o aplicație de învățare mai bună. Nu scrie nicăieri numele tău adevărat. Te poți opri oricând.',
  'start.assent': 'Sunt de acord să particip',
  'start.button': 'Începe',
  'start.resume': 'Continui ca {username}?',
  'start.resume_yes': 'Da, continui',
  'start.resume_no': 'Nu, sunt alt jucător',
  'closed.text': 'Quizul nu este deschis acum. Revino mai târziu.',
  'name.title': 'Alege-ți un nume de jucător',
  'name.hint': 'Nu folosi numele tău adevărat. Alege unul dintre acestea:',
  'name.more': 'Alte nume',
  'name.have': 'Am deja un nume',
  'name.have_prompt': 'Scrie numele tău de jucător',
  'name.have_error': 'Nu găsim acest nume. Verifică-l sau alege unul nou.',
  'name.continue': 'Continuă',
  'profile.title': 'Câteva întrebări rapide',
  'profile.start': 'Începem!',
  'q.progress': 'Întrebarea {n} din {N}',
  'q.placeholder': 'Scrie răspunsul cu cuvintele tale…',
  'q.submit': 'Trimite',
  'q.dontknow': 'Nu știu',
  'q.checking': 'Se verifică răspunsul…',
  'correct.title': 'Corect! Bravo!',
  next: 'Mai departe',
  'mistake.title': 'Nu chiar. Mai încearcă o dată.',
  'mistake.loading': 'Se pregătește ajutorul…',
  'hint.label': 'Indiciu',
  'example.label': 'Exemplu rezolvat',
  'retry.placeholder': 'Scrie din nou răspunsul tău…',
  'retry.submit': 'Trimite din nou',
  'result.success': 'Acum e corect! Bravo!',
  'result.fail': 'Nu încă, dar e în regulă. Uite explicația:',
  'explanation.label': 'Explicație',
  'rating.question': 'Cât de mult te-a ajutat ajutorul primit înainte să încerci din nou?',
  'rating.ends': ['Deloc', 'Foarte mult'],
  skip: 'Sari peste',
  'survey.title': 'Aproape gata!',
  'survey.fair': 'Mi s-a părut corect cum au fost verificate răspunsurile mele.',
  'survey.understood': 'După ajutor, am înțeles mai bine.',
  'survey.want_again': 'Aș vrea să mai folosesc o aplicație ca asta.',
  'survey.ends': ['Deloc de acord', 'Total de acord'],
  'survey.comment': 'Ce ți-a plăcut sau nu ți-a plăcut? Scrie orice (nu e obligatoriu).',
  'survey.finish': 'Termină',
  'done.title': 'Mulțumim, {username}!',
  'done.save': 'Notează-ți numele de jucător. Îl poți folosi data viitoare.',
  'done.button': 'Gata',
  'fallback.grader': 'Nu am putut verifica răspunsul acum. Uite explicația:',
  'error.generic': 'Ceva n-a mers. Încearcă din nou.',
  'error.retry': 'Încearcă din nou',
} as const;

type Option<V extends string | number | null> = { label: string; value: V };

export const profileQuestions = {
  grade: {
    label: 'În ce clasă ești?',
    options: [
      { label: 'a IV-a', value: 4 },
      { label: 'a V-a', value: 5 },
      { label: 'a VI-a', value: 6 },
      { label: 'a VII-a', value: 7 },
      { label: 'a VIII-a', value: 8 },
      { label: 'a IX-a', value: 9 },
      { label: 'a X-a', value: 10 },
      { label: 'a XI-a', value: 11 },
      { label: 'a XII-a', value: 12 },
      { label: 'Altceva', value: null },
    ] as Option<number | null>[],
  },
  ageBand: {
    label: 'Câți ani ai?',
    options: [
      { label: 'sub 10', value: 'under10' },
      { label: '10–11', value: '10-11' },
      { label: '12–13', value: '12-13' },
      { label: '14–15', value: '14-15' },
      { label: '16–17', value: '16-17' },
      { label: '18 sau mai mult', value: '18plus' },
    ] as Option<string>[],
  },
  gender: {
    label: 'Ești:',
    options: [
      { label: 'Băiat', value: 'boy' },
      { label: 'Fată', value: 'girl' },
      { label: 'Prefer să nu spun', value: 'undisclosed' },
    ] as Option<string>[],
  },
  prior: {
    label: 'Ai mai făcut acest quiz înainte?',
    options: [
      { label: 'Da', value: 'yes' },
      { label: 'Nu', value: 'no' },
      { label: 'Nu sunt sigur(ă)', value: 'unsure' },
    ] as Option<string>[],
  },
  setting: {
    label: 'Unde faci quizul acum?',
    options: [
      { label: 'La curs', value: 'class' },
      { label: 'Acasă', value: 'home' },
      { label: 'Altundeva', value: 'other' },
    ] as Option<string>[],
  },
};

export const surveyPreferred = {
  label: 'Când greșești, ce fel de ajutor îți place cel mai mult?',
  options: [
    { label: 'Doar să mi se spună să mai încerc', value: 'plain' },
    { label: 'Un indiciu', value: 'hint' },
    { label: 'Un exemplu rezolvat asemănător', value: 'example' },
    { label: 'Nu știu', value: 'unsure' },
  ] as Option<string>[],
};

export const EMOJI_SCALE = ['😞', '🙁', '😐', '🙂', '😄'] as const;

export const NAME_REACTION_FALLBACKS = [
  'Ce nume tare! Hai să vedem ce știi.',
  'Nume de campion! Începem?',
  'Super alegere! Aventura începe acum.',
  'Îmi place! Sună a cineva care rezolvă orice.',
  'Nume legendar! Ești gata de primele întrebări?',
  'Excelent! Hai la treabă.',
  'Ce nume creativ! Să începem.',
  'Bun venit în joc!',
];

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
