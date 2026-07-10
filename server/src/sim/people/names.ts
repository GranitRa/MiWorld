import type { Colonist, Sex } from "@miworld/shared";
import type { RngGateway } from "../rng";

// Minimal name/role/trait banks for the founding crew. WP-7 expands this into a full
// phonology + relationship model; for WP-5 we just need named individuals to consume
// life support.

const GIVEN_F = ["Mara", "Ines", "Yuki", "Nadia", "Lena", "Sofia", "Amara", "Wren", "Tessa", "Ravi"];
const GIVEN_M = ["Kai", "Tariq", "Bjorn", "Milo", "Dario", "Ivo", "Rune", "Cole", "Anders", "Owen"];
const SURNAMES = ["Vega", "Okafor", "Sato", "Reyes", "Kovac", "Haas", "Bauer", "Nazari", "Frost", "Lindqvist", "Adeyemi", "Marchetti"];
const ROLES = ["Commander", "Engineer", "Doctor", "Botanist", "Geologist", "Technician", "Chemist", "Pilot", "Medic", "Metallurgist"];
const TRAITS = ["bold", "cautious", "kind", "stern", "clever", "tough", "restless", "devout", "curious", "loyal", "proud", "patient"];

const pick = <T>(rng: RngGateway, stream: string, arr: readonly T[]): T =>
  arr[rng.int(stream, arr.length)]!;

export function makeColonist(rng: RngGateway, id: string, roleIndex: number): Colonist {
  const sex: Sex = rng.next("crew") < 0.5 ? "f" : "m";
  const given = pick(rng, "crew", sex === "f" ? GIVEN_F : GIVEN_M);
  const surname = pick(rng, "crew", SURNAMES);
  const role = ROLES[roleIndex % ROLES.length]!;
  const traits = [pick(rng, "crew", TRAITS), pick(rng, "crew", TRAITS)].filter(
    (t, i, a) => a.indexOf(t) === i,
  );
  return {
    id,
    name: `${given} ${surname}`,
    role,
    sex,
    ageDays: Math.floor(rng.range("crew", 28, 52) * 668), // ~28–52 Earth years in sols
    traits,
    bonds: {},
    alive: true,
  };
}
