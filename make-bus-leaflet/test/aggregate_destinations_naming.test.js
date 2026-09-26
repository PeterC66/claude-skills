/*
 * aggregate_destinations_naming.test.js — the place drafter names a spoke after the
 * settlement it reaches, not the stop it ends at (buses-data OA-438).
 *
 * The rules are small and each one is a measured case, so each gets a case here:
 * a district of another town climbs to that town (Newnham -> Cambridge), a district
 * of the place's own town does not (Eynesbury stays Eynesbury from St Neots), London
 * is never climbed to (Uxbridge stays Uxbridge), the busiest of several spokes into
 * one settlement keeps the bare name, and a lone spoke into the place's own town is
 * its town centre. Without --localities the old stop-name label must be unchanged.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { placeName, labelClusters } = require(path.join(__dirname, '..', '..', 'make-place-bus-leaflet', 'assets', 'aggregate_destinations.js'));

const LOC = {
  NEWNHAM: ['Newnham', 'Cambridge'],
  EYNES: ['Eynesbury', 'St Neots'],
  UXB: ['Uxbridge', 'London'],
  SN: ['St Neots', null],
  HUNT: ['Huntingdon', null],
  HINCH: ['Hinchingbrooke', 'Huntingdon'],
};

test('placeName climbs to another town, never to its own town or to London', () => {
  assert.strictEqual(placeName('NEWNHAM', LOC, 'St Neots'), 'Cambridge');
  assert.strictEqual(placeName('EYNES', LOC, 'St Neots'), 'Eynesbury');
  assert.strictEqual(placeName('UXB', LOC, 'Beaconsfield'), 'Uxbridge');
  assert.strictEqual(placeName('SN', LOC, 'St Neots'), 'St Neots');
  assert.strictEqual(placeName('NOWHERE', LOC, 'St Neots'), null);
  assert.strictEqual(placeName('SN', null, 'St Neots'), null);
});

const ep = (route, name, place) => ({ route, name, place });

test('the busiest spoke into a settlement keeps the bare name; the others carry their stop', () => {
  const groups = [
    [ep('9', 'Bus Station', 'Huntingdon'), ep('101', 'Bus Station', 'Huntingdon')],
    [ep('X3', 'Hinchingbrooke Hospital', 'Huntingdon')],
    [ep('66', 'Market Square', 'St Neots')],
  ];
  assert.deepStrictEqual(labelClusters(groups, 'Godmanchester'),
    ['Huntingdon', 'Huntingdon (Hinchingbrooke Hospital)', 'St Neots']);
});

test('one spoke into the own town is its town centre; several are told apart by stop', () => {
  assert.deepStrictEqual(labelClusters([[ep('18', 'Market Square', 'St Neots')]], 'St Neots'),
    ['St Neots town centre']);
  assert.deepStrictEqual(labelClusters([
    [ep('27', 'Orchard Road', 'High Wycombe')],
    [ep('WW1', 'Adams Park', 'High Wycombe')],
  ], 'High Wycombe'), ['High Wycombe (Orchard Road)', 'High Wycombe (Adams Park)']);
});

test('without localities the label is the modal stop name, exactly as before', () => {
  const groups = [
    [ep('18', 'Market Square', null), ep('C2', 'Market Square', null)],
    [ep('66', 'Bus Station', null)],
    [ep('905', 'Bus Station', null)],
  ];
  assert.deepStrictEqual(labelClusters(groups, null), ['Market Square', 'Bus Station', 'Bus Station']);
});
