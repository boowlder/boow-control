import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Assemble des classes conditionnelles, puis tranche les conflits.
 *
 * `clsx` seul laisserait cohabiter `px-2` et `px-4` : la dernière déclarée
 * dans la feuille de style gagnerait, pas la dernière écrite dans le code.
 * `twMerge` fait le ménage — le dernier écrit gagne. C'est ce qui rend une
 * prop `className` fiable sur un composant qui porte déjà ses propres classes.
 *
 * Toute la bibliothèque shadcn/ui attend cette fonction sous ce nom.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
