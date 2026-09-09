/**
 * Funky Notionist Avatar Generator using DiceBear v9 API
 * Supports gender-matched hairstyles and specialized roles (like Cool Tech Guy)
 */

export const PASTEL_BACKGROUNDS = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf'];

export const FEMALE_HAIR_VARIANTS = [
  'variant63', 'variant62', 'variant61', 'variant58', 'variant57',
  'variant51', 'variant50', 'variant49', 'variant48', 'variant47',
  'variant46', 'variant45', 'variant43', 'variant42', 'variant41',
  'variant40', 'variant36', 'variant32', 'variant31', 'variant30',
  'variant28', 'variant27', 'variant26', 'variant25', 'variant24',
  'variant23', 'variant22', 'variant21', 'variant20', 'variant19',
  'variant18', 'variant17', 'variant16'
];

export const MALE_HAIR_VARIANTS = [
  'variant60', 'variant59', 'variant56', 'variant55', 'variant54',
  'variant53', 'variant52', 'variant44', 'variant39', 'variant38',
  'variant37', 'variant35', 'variant34', 'variant33', 'variant29',
  'variant15', 'variant14', 'variant13', 'variant12', 'variant11',
  'variant10', 'variant09', 'variant08', 'variant07', 'variant06',
  'variant05', 'variant04', 'variant03', 'variant02', 'variant01'
];

const KNOWN_FEMALE_FIRST_NAMES = new Set([
  'disha', 'vrinda', 'rupanshi', 'yashvi', 'janavi', 'sunidhi',
  'aarna', 'shreya', 'sneha', 'anushka', 'tanu', 'supriya',
  'tanzil', 'angel', 'asmita', 'nehal', 'gurnayan', 'divya',
  'nimisha', 'kanishka', 'nishtha', 'aayushi', 'shristy', 'priya',
  'ananya', 'pooja', 'neha', 'isha', 'simran', 'riya', 'rhea',
  'tanvi', 'aditi', 'muskan', 'kriti', 'khushi', 'palak', 'sakshi',
  'megha', 'shweta', 'pallavi', 'anjali', 'sonali', 'radhika', 'swati', 'mannat'
]);

/**
 * Detect gender based on name or roll number heuristics
 */
export function detectGender(nameOrIdentifier?: string): 'female' | 'male' {
  if (!nameOrIdentifier) return 'male';
  const clean = nameOrIdentifier.trim().toLowerCase();

  // Check specific Gyanendra check
  if (clean.includes('gyanendra') || clean.includes('s24cseu0771')) {
    return 'male';
  }

  // Check first name against known female names
  const firstName = clean.split(/[\s._-]+/)[0];
  if (KNOWN_FEMALE_FIRST_NAMES.has(firstName)) {
    return 'female';
  }

  // Common Indian female name endings
  if (clean.includes(' kaur') || clean.includes(' kumari') || clean.includes(' devi')) {
    return 'female';
  }

  return 'male';
}

/**
 * Generate a Cool Tech Guy avatar for Gyanendra
 */
export function generateCoolTechGuyAvatar(seed = 'Gyanendra-Head-Of-Tech'): string {
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  // Tech guy: developer glasses, ok or phone gesture, electric lightning badge, stylish haircut, cyan backdrop
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed)}-${randomSuffix}&hair=variant59,variant14,variant37&glasses=variant01,variant02&glassesProbability=100&gesture=ok,handPhone&gestureProbability=100&bodyIcon=electric,saturn&bodyIconProbability=100&beardProbability=0&backgroundColor=b6e3f4`;
}

/**
 * Generate a gender-matched Notionist avatar URL
 */
export function generateNotionistAvatar(
  seed?: string,
  explicitGender?: 'male' | 'female'
): string {
  const cleanSeed = seed ? seed.trim() : '';

  // Special Gyanendra cool tech guy case
  if (cleanSeed.toLowerCase().includes('gyanendra') || cleanSeed.toLowerCase().includes('s24cseu0771')) {
    return generateCoolTechGuyAvatar(cleanSeed || 'Gyanendra-Head-Of-Tech');
  }

  const gender = explicitGender || detectGender(cleanSeed);
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const fullSeed = cleanSeed ? `${encodeURIComponent(cleanSeed.replace(/\s+/g, '-'))}-${randomSuffix}` : randomSuffix;
  const bgParam = PASTEL_BACKGROUNDS.join(',');

  if (gender === 'female') {
    // Pick from feminine hair variants and strictly disable beards
    const hairPool = FEMALE_HAIR_VARIANTS.join(',');
    return `https://api.dicebear.com/9.x/notionists/svg?seed=${fullSeed}&hair=${hairPool}&beardProbability=0&backgroundColor=${bgParam}`;
  } else {
    // Masculine hair variants with optional light beard
    const hairPool = MALE_HAIR_VARIANTS.join(',');
    return `https://api.dicebear.com/9.x/notionists/svg?seed=${fullSeed}&hair=${hairPool}&beardProbability=25&backgroundColor=${bgParam}`;
  }
}
