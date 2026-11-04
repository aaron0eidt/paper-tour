import {
  DEFAULT_INTERFACE_PREFERENCES,
  parseInterfacePreferences,
  type InterfacePreferences,
} from '../src/ui/preferences';

function check(value: boolean) {
  if (!value) throw new Error('Interface preferences were not restored safely');
}
function samePreferences(actual: InterfacePreferences, expected: InterfacePreferences) {
  check(
    actual.sounds === expected.sounds && actual.pack === expected.pack && actual.volume === expected.volume,
  );
}
for (const raw of [null, 'broken json', 'null', '42', '{"sounds":"true","volume":"loud","pack":"deleted"}']) {
  samePreferences(parseInterfacePreferences(raw), DEFAULT_INTERFACE_PREFERENCES);
}
check(parseInterfacePreferences('{"sounds":true,"volume":4,"pack":"zen"}').volume === 1);
check(parseInterfacePreferences('{"volume":-2}').volume === 0);
samePreferences(parseInterfacePreferences('{"sounds":true,"volume":0.4,"pack":"studio"}'), {
  sounds: true,
  volume: 0.4,
  pack: 'studio',
});
console.log(
  'ok damaged interface preferences cannot enable sounds or break the interface; valid choices survive',
);
