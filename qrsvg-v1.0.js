/** SPDX-License-Identifier: MIT
 ******************************************************************************
 * QRSVG
 * Version 1.0
 * https://fietkau.software/qr
 * Copyright (c) Julian Fietkau
 *
 * This is a small JavaScript project to render a two-dimensional bitmask
 * (mostly assumed to be a QR code) with a fixed width and height to an SVG
 * element as a collection of SVG paths with defined purposes. The code
 * analyzes the bitmask geometrically and traces the contours of contiguous
 * shapes. It allows rendering QR codes in several stylized ways. Note that
 * this code does not contain an actual QR code creator – it expects to receive
 * the 2D QR code as a bitmask for its input. See the project website for a
 * demo and more information.
 ******************************************************************************
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the “Software”), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 ******************************************************************************
 */

'use strict';
var qrsvg;
(function (qrsvg) {

// Data class holding four SVG pathspecs that make up a QR code pattern.
// There are separate properties for the inner and outer parts of the position
// detection pattern, for 1x1 blocks in the pattern and for all larger shapes.
// This separation is for later ease in distinct coloration.
// The pathspecs are held as arrays instead of strings so their component parts
// can be more easily iterated and manipulated. This is necessary for the
// application of shape styles.
class Contour {

  constructor() {
    this.pdpOuter = [];
    this.pdpInner = [];
    this.dots = [];
    this.shapes = [];
  }
}

// Data class holding a rectangular bitmask, accessible as x/y coordinates
// returning boolean values.
class Bitmask {

  constructor(width, height) {
    if(!Number.isInteger(width) || !Number.isInteger(height)) {
      throw Error('Bitmask: width and height must be integers: ' + width + ', ' + height);
    }
    this.width = width;
    this.height = height;
    this._array = new Array(width * height);
    this.wipe(false);
  }

  get(x, y) {
    if(!Number.isInteger(x) || !Number.isInteger(y)) {
      throw Error('Bitmask: x and y must be integers: ' + x + ', ' + y);
    }
    if(x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false;
    }
    return this._array[y * this.width + x];
  }

  set(x, y, value) {
    if(!Number.isInteger(x) || !Number.isInteger(y)) {
      throw Error('Bitmask: x and y must be integers: ' + x + ', ' + y);
    }
    if(x < 0 || x >= this.width) {
      throw Error('Bitmask: x must be at least 0 and less than width: ' + x);
    }
    if(y < 0 || y >= this.height) {
      throw Error('Bitmask: y must be at least 0 and less than height: ' + y);
    }
    this._array[y * this.width + x] = value;
  }

  // Fully overwrite the current data with a sequence of boolean
  // values. In the simplest case, call wipe(false) to set all
  // coordinates to false, or provide more values. They will be
  // repeated in sequence as often as needed.
  wipe(...pattern) {
    for(let i = 0; i < this._array.length; i++) {
      this._array[i] = pattern[i % pattern.length];
    }
  }
}

// Mini pseudo-random number generator. Used because rerendering
// jittered bitmasks is easier when we can do it deterministically.
class PRNG {
  constructor(seed) {
    // LCG using GCC's constants
    this.m = 0x80000000;
    this.a = 1103515245;
    this.c = 12345;
    this.state = seed ? seed : Math.floor(Math.random() * (this.m - 1));
  }
  next() {
    this.state = (this.a * this.state + this.c) % this.m;
    return this.state / (this.m - 1);
  }
}

// Take an existing segmented pathspec and round its corners.
// Used by `rounded` and `dots` styles.
function makePathSpecRound(oldPathSpec) {
  let isInnerContour;
  let newPathSpec = new Array();
  for(let i = 0; i < oldPathSpec.length; i++) {
    if(oldPathSpec[i].startsWith('M')) {
      let coords = oldPathSpec[i].substring(1).split(' ').map(c => parseInt(c, 10));
      if(oldPathSpec[i+1].startsWith('h')) {
        coords[0] += 0.5;
        isInnerContour = false;
      } else if(oldPathSpec[i+1].startsWith('v')) {
        coords[1] += 0.5;
        isInnerContour = true;
      }
      newPathSpec.push('M' + coords[0] + ' ' + coords[1]);
      i++; // Skip the first horizontal line segment
    }
    if(oldPathSpec[i] == 'z') {
      if(isInnerContour) {
        newPathSpec.push('a0.5 0.5 0 0 0 -0.5 0.5');
      } else {
        newPathSpec.push('a0.5 0.5 0 0 1 0.5 -0.5');
      }
      newPathSpec.push('z');
      // End this loop iteration here because (a) if this is the last path
      // segment, trying to access i+1 further down would cause errors,
      // and (b) because we might as well.
      continue;
    }
    if(oldPathSpec[i] == 'h1' && oldPathSpec[i+1] == 'h1') {
      newPathSpec.push('h1');
    }
    if(oldPathSpec[i] == 'h-1' && oldPathSpec[i+1] == 'h-1') {
      newPathSpec.push('h-1');
    }
    if(oldPathSpec[i] == 'v1' && oldPathSpec[i+1] == 'v1') {
      newPathSpec.push('v1');
    }
    if(oldPathSpec[i] == 'v-1' && oldPathSpec[i+1] == 'v-1') {
      newPathSpec.push('v-1');
    }
    if(oldPathSpec[i] == 'h1' && oldPathSpec[i+1] == 'v1') {
      newPathSpec.push('a0.5 0.5 0 0 1 0.5 0.5');
    }
    if(oldPathSpec[i] == 'h1' && oldPathSpec[i+1] == 'v-1') {
      newPathSpec.push('a0.5 0.5 0 0 0 0.5 -0.5');
    }
    if(oldPathSpec[i] == 'h-1' && oldPathSpec[i+1] == 'v1') {
      newPathSpec.push('a0.5 0.5 0 0 0 -0.5 0.5');
    }
    if(oldPathSpec[i] == 'h-1' && oldPathSpec[i+1] == 'v-1') {
      newPathSpec.push('a0.5 0.5 0 0 1 -0.5 -0.5');
    }
    if(oldPathSpec[i] == 'v1' && oldPathSpec[i+1] == 'h1') {
      newPathSpec.push('a0.5 0.5 0 0 0 0.5 0.5');
    }
    if(oldPathSpec[i] == 'v1' && oldPathSpec[i+1] == 'h-1') {
      newPathSpec.push('a0.5 0.5 0 0 1 -0.5 0.5');
    }
    if(oldPathSpec[i] == 'v-1' && oldPathSpec[i+1] == 'h1') {
      newPathSpec.push('a0.5 0.5 0 0 1 0.5 -0.5');
    }
    if(oldPathSpec[i] == 'v-1' && oldPathSpec[i+1] == 'h-1') {
      newPathSpec.push('a0.5 0.5 0 0 0 -0.5 -0.5');
    }
    let len = newPathSpec.length;
    if(len >= 2 && newPathSpec[len-1][0] == newPathSpec[len-2][0] && ['h', 'v'].includes(newPathSpec[len-1][0])) {
      let command = newPathSpec[len-1][0];
      let delta1 = parseInt(newPathSpec.pop().slice(1), 10);
      let delta2 = parseInt(newPathSpec.pop().slice(1), 10);
      newPathSpec.push(command + (delta1 + delta2));
    }
  }
  return newPathSpec;
}

function addJitterToPathSpec(oldPathSpec, jitterValue, prng) {
  let newPathSpec = []
  let currentPos = [null, null];
  for(let step of oldPathSpec) {
    if(step.startsWith('M')) {
      currentPos = step.slice(1).split(' ').map(c => parseInt(c, 10));
      newPathSpec.push(step);
    } else if(step.startsWith('h') || step.startsWith('v')) {
      let posIndex = 0; // default: h
      if(step.startsWith('v')) {
        posIndex = 1;
      }
      let distance = parseInt(step.slice(1), 10);
      currentPos[posIndex] += distance;
      let jitteredPos = currentPos.map(c => c + (prng.next() * 2 - 1) * jitterValue);
      newPathSpec.push('L' + jitteredPos[0] + ' ' + jitteredPos[1]);
    } else {
      newPathSpec.push(step);
    }
  }
  return newPathSpec;
}

function compactPathSpec(oldPathSpec) {
  let newPathSpec = [];
  if(oldPathSpec.length == 0) {
    return newPathSpec;
  }
  newPathSpec.push(oldPathSpec[0]);
  for(let step of oldPathSpec.slice(1)) {
    let prev = newPathSpec[newPathSpec.length - 1];
    if((step[0] == 'h' || step[0] == 'v') && step[0] == prev[0]) {
      let distance = parseInt(prev.substring(1), 10) + parseInt(step.substring(1), 10);
      newPathSpec[newPathSpec.length - 1] = step[0] + distance;
    } else {
      newPathSpec.push(step);
    }
  }
  return newPathSpec;
}

// Special case method to calculate contours for the two styles
// where shapes are not contiguous. This also skips the PDP.
function calculateDotsOrMosaicContour(bitmask, margin, style) {
  if(style != 'dots' && style != 'mosaic') {
    throw Error('Unsupported dots/mosaic render style: ' + style);
  }
  let contour = new Contour();
  let prng = new PRNG(1);
  for(let y = 0; y < bitmask.height; y++) {
    for(let x = 0; x < bitmask.width; x++) {
      if(bitmask.width > 16 && bitmask.height > 16) {
        // Check if we are inside a PDP area, because they have already been handled separately.
        if((x < 7 + margin && y < 7 + margin) ||
           (x < 7 + margin && y > bitmask.height - margin - 7) ||
           (x > bitmask.width - margin - 7 && y < 7 + margin)) {
          continue;
        }
      }
      if(bitmask.get(x, y)) {
        let newPathSpec = new Array();
        if(style == 'dots') {
          newPathSpec.push('M' + (x + margin + 0.5) + ' ' + (y + margin));
          newPathSpec.push('a0.5 0.5 0 0 1 0.5 0.5');
          newPathSpec.push('a0.5 0.5 0 0 1 -0.5 0.5');
          newPathSpec.push('a0.5 0.5 0 0 1 -0.5 -0.5');
          newPathSpec.push('a0.5 0.5 0 0 1 0.5 -0.5');
          newPathSpec.push('z');
        }
        if(style == 'mosaic') {
          // For the mosaic style, we jury-rig a pseudo-random rotation for each pixel.
          let size = 0.9; // relative to grid size
          let maxAngle = Math.PI * 0.03;
          let angle = (prng.next() * 2 - 1) * maxAngle;
          //             |------ middle of the pixel ------|   |-north displacement-|  |-west displacement-|
          let topLeftX = x + margin + 0.5 + ((1 - size) / 2) - 0.5 * Math.cos(angle) + 0.5 * Math.sin(angle);
          let topLeftY = y + margin + 0.5 + ((1 - size) / 2) + 0.5 * Math.cos(angle) - 0.5 * Math.sin(angle) - 1;
          newPathSpec.push('M' + topLeftX.toPrecision(3) + ' ' + topLeftY.toPrecision(3));
          newPathSpec.push('l' + (size * Math.cos(angle)).toPrecision(3) + ' ' + (size * Math.sin(angle)).toPrecision(3));
          newPathSpec.push(('l-' + (size * Math.sin(angle)).toPrecision(3) + ' ' + (size * Math.cos(angle)).toPrecision(3)).replaceAll('--', ''));
          newPathSpec.push(('l-' + (size * Math.cos(angle)).toPrecision(3) + ' -' + (size * Math.sin(angle)).toPrecision(3)).replaceAll('--', ''));
          newPathSpec.push(('l' + (size * Math.sin(angle)).toPrecision(3) + ' -' + (size * Math.cos(angle)).toPrecision(3)).replaceAll('--', ''));
          newPathSpec.push('z');
        }
        if(!bitmask.get(x - 1, y) && !bitmask.get(x + 1, y) && !bitmask.get(x, y - 1) && !bitmask.get(x, y + 1)) {
          contour.dots = contour.dots.concat(newPathSpec);
        } else {
          contour.shapes = contour.shapes.concat(newPathSpec);
        }
      }
    }
  }
  return contour;
}

// For styles other than `dots` or `mosaic`, this method traces along
// contiguous shapes in the bitmask and builds a contour. Still skips
// the PDP and assumes it is handled separately.
function calculateShapeContour(bitmask, margin, style) {
  let contour = new Contour();
  let corners = new Array();
  let width = bitmask.width + 1;
  let height = bitmask.height + 1;
  for(let y = 0; y < height; y++) {
    for(let x = 0; x < width; x++) {
      corners.push({});
    }
  }
  for(let y = 0; y < height; y++) {
    for(let x = 0; x < width; x++) {
      if(Object.keys(corners[y * width + x]).includes('e')) continue;
      if(bitmask.get(x, y) == bitmask.get(x - 1, y) && bitmask.get(x, y) == bitmask.get(x, y - 1)
         && bitmask.get(x, y) == bitmask.get(x - 1, y - 1)) continue; // This corner is not part of any edge.
      if(bitmask.get(x, y - 1) || !bitmask.get(x, y)) continue;
      let contourX = x;
      let contourY = y;
      let direction = 'e';
      while(!corners[contourY * width + contourX][direction]) {
        let prevDirection = direction;
        if(direction == 'n') {
          if(bitmask.get(contourX, contourY - 1) && !bitmask.get(contourX - 1, contourY - 1)) {
            corners[contourY * width + contourX][direction] = [contourX, contourY - 1];
          } else if(!bitmask.get(contourX, contourY - 1)) {
            corners[contourY * width + contourX][direction] = [contourX + 1, contourY];
            direction = 'e';
          } else if(bitmask.get(contourX - 1, contourY - 1) && bitmask.get(contourX, contourY - 1)) {
            corners[contourY * width + contourX][direction] = [contourX - 1, contourY];
            direction = 'w';
          }
        } else if(direction == 'e') {
          if(bitmask.get(contourX, contourY) && !bitmask.get(contourX, contourY - 1)) {
            corners[contourY * width + contourX][direction] = [contourX + 1, contourY];
          } else if(!bitmask.get(contourX, contourY)) {
            corners[contourY * width + contourX][direction] = [contourX, contourY + 1];
            direction = 's';
          } else if(bitmask.get(contourX, contourY) && bitmask.get(contourX, contourY - 1)) {
            corners[contourY * width + contourX][direction] = [contourX, contourY - 1];
            direction = 'n';
          }
        } else if(direction == 's') {
          if(bitmask.get(contourX - 1, contourY) && !bitmask.get(contourX, contourY)) {
            corners[contourY * width + contourX][direction] = [contourX, contourY + 1];
          } else if(!bitmask.get(contourX - 1, contourY)) {
            corners[contourY * width + contourX][direction] = [contourX - 1, contourY];
            direction = 'w';
          } else if(bitmask.get(contourX, contourY) && bitmask.get(contourX - 1, contourY)) {
            corners[contourY * width + contourX][direction] = [contourX + 1, contourY];
            direction = 'e';
          }
        } else if(direction == 'w') {
          if(bitmask.get(contourX - 1, contourY - 1) && !bitmask.get(contourX - 1, contourY)) {
            corners[contourY * width + contourX][direction] = [contourX - 1, contourY];
          } else if(!bitmask.get(contourX - 1, contourY - 1)) {
            corners[contourY * width + contourX][direction] = [contourX, contourY - 1];
            direction = 'n';
          } else if(bitmask.get(contourX - 1, contourY) && bitmask.get(contourX - 1, contourY - 1)) {
            corners[contourY * width + contourX][direction] = [contourX, contourY + 1];
            direction = 's';
          }
        }
        let next = corners[contourY * width + contourX][prevDirection];
        if(!next) break;
        contourX = next[0];
        contourY = next[1];
      }
    }
  }
  for(let y = 0; y < height; y++) {
    for(let x = 0; x < width; x++) {
      if(bitmask.width > 16 && bitmask.height > 16) {
        // Check if we are inside a PDP area, because they have already been handled separately.
        if((x < 7 + margin && y < 7 + margin) ||
           (x < 7 + margin && y > bitmask.height - margin - 7) ||
           (x > bitmask.width - margin - 7 && y < 7 + margin)) {
          continue;
        }
      }
      if(Object.keys(corners[y * width + x]).length == 0) continue;
      let direction = Object.keys(corners[y * width + x])[0];
      let newPathSpec = new Array();
      newPathSpec.push('M' + (x + margin) + ' ' + (y + margin));
      let contourX = x;
      let contourY = y;
      while(corners[contourY * width + contourX][direction]) {
        let next = corners[contourY * width + contourX][direction];
        let prevSpecStep = newPathSpec[newPathSpec.length - 1];
        delete corners[contourY * width + contourX][direction];
        let pathCommand, pathDelta;
        if(next[0] > contourX) {
          direction = 'e';
          pathCommand = 'h';
          pathDelta = 1;
        } else if(next[0] < contourX) {
          direction = 'w';
          pathCommand = 'h';
          pathDelta = -1;
        } else if(next[1] > contourY) {
          direction = 's';
          pathCommand = 'v';
          pathDelta = 1;
        } else if(next[1] < contourY) {
          direction = 'n';
          pathCommand = 'v';
          pathDelta = -1;
        }
        newPathSpec.push(pathCommand + pathDelta);
        contourX = next[0];
        contourY = next[1];
      }
      // Skip non-shaped paths for serialization
      if(newPathSpec.length <= 2) continue;
      // Avoid double-pathing the initial segment
      if(newPathSpec.length % 2 == 0) {
        newPathSpec.pop();
      }
      // Technically at this point we should have already returned to the start,
      // but adding an explicit `z` anyway helps with rendering under some
      // circumstances. For pure line segment paths we could use `z` to jump
      // back instead of making the last step before here explicit, but that can
      // interfere with the way we round corners in some styles.
      newPathSpec.push('z');
      if(newPathSpec.length == 6 && !newPathSpec[1].startsWith('v')) {
        contour.dots = contour.dots.concat(newPathSpec);
      } else {
        contour.shapes = contour.shapes.concat(newPathSpec);
      }
    }
  }
  return contour;
}

// Overarching method that turns a 2D bitmask into a set of contour pathspecs.
// `margin` is an offset that is added to all x and y coordinates in the output.
// output. It defaults to 1 to accommodate jitter and mosaic styles that have
// elements randomly extending slightly outside of the basic QR code area.
function calculateContour(bitmask, margin = 1, style = 'basic') {
  let contour = new Contour();
  if(bitmask.width > 16 && bitmask.height > 16) {
    // This is where we build the PDP contours, regardless of style. Skipped for
    // bitmasks below a size threshold - those are assumed to not be valid QR codes.
    // I also tried rendering the PDP paths as individual "pixels" in the dots and
    // mosaic styles, but that led to bad scanning compatibility, so we take care
    // to keep those more solid than the rest of the code.
    for(let offset of [[margin, margin], [bitmask.width + margin - 7, margin], [margin, bitmask.height + margin - 7]]) {
      contour.pdpOuter.push('M' + offset[0] + ' ' + offset[1]);
      contour.pdpOuter.push(...Array(7).fill('h1'));
      contour.pdpOuter.push(...Array(7).fill('v1'));
      contour.pdpOuter.push(...Array(7).fill('h-1'));
      contour.pdpOuter.push(...Array(7).fill('v-1'));
      contour.pdpOuter.push('z');
      contour.pdpOuter.push('M' + (offset[0] + 1) + ' ' + (offset[1] + 1));
      contour.pdpOuter.push(...Array(5).fill('v1'));
      contour.pdpOuter.push(...Array(5).fill('h1'));
      contour.pdpOuter.push(...Array(5).fill('v-1'));
      contour.pdpOuter.push(...Array(5).fill('h-1'));
      contour.pdpOuter.push('z');
      contour.pdpInner.push('M' + (offset[0] + 2) + ' ' + (offset[1] + 2));
      contour.pdpInner.push(...Array(3).fill('h1'));
      contour.pdpInner.push(...Array(3).fill('v1'));
      contour.pdpInner.push(...Array(3).fill('h-1'));
      contour.pdpInner.push(...Array(3).fill('v-1'));
      contour.pdpInner.push('z');
    }
    if(style == 'dots' || style == 'rounded') {
      contour.pdpInner = makePathSpecRound(contour.pdpInner);
      contour.pdpOuter = makePathSpecRound(contour.pdpOuter);
    }
  }
  let newContour;
  if(style == 'dots' || style == 'mosaic') {
    newContour = calculateDotsOrMosaicContour(bitmask, margin, style);
  } else {
    newContour = calculateShapeContour(bitmask, margin, style);
  }
  contour.dots = newContour.dots;
  contour.shapes = newContour.shapes;
  if(style == 'rounded') {
    contour.shapes = makePathSpecRound(contour.shapes);
    contour.dots = makePathSpecRound(contour.dots);
  }
  if(style.startsWith('jitter-')) {
    let jitterValue = 0.0;
    // Suitable jitter values that still lead to good scanning compatibility
    // have been derived experimentally. Customize as you see fit.
    if(style == 'jitter-heavy') {
      jitterValue = 0.15;
    } else if (style == 'jitter-light') {
      jitterValue = 0.07;
    }
    let prng = new PRNG(1);
    // It's important to jitterize the shapes and dots first, as they
    // are different for every QR code. Reusing the same PRNG afterwards
    // for the PDP paths ensures that they get different jitter values
    // for different QR codes and thus not look the same every time.
    contour.shapes = addJitterToPathSpec(contour.shapes, jitterValue, prng);
    contour.dots = addJitterToPathSpec(contour.dots, jitterValue, prng);
    contour.pdpInner = addJitterToPathSpec(contour.pdpInner, jitterValue, prng);
    contour.pdpOuter = addJitterToPathSpec(contour.pdpOuter, jitterValue, prng);
  } else {
    contour.shapes = compactPathSpec(contour.shapes);
    contour.dots = compactPathSpec(contour.dots);
    contour.pdpInner = compactPathSpec(contour.pdpInner);
    contour.pdpOuter = compactPathSpec(contour.pdpOuter);
  }
  return contour;
}

// This is the main callable method to render a bitmask into an SVG
// element using a specific render style. The SVG element will be
// cleared, the viewBox will be adjusted as needed, and four path
// elements will be created within containing the PDP inner and
// outer parts, dots, and other shapes. See a few lines below for
// the list of valid styles.
function render(bitmask, renderTarget, style = 'basic') {
  if(!['basic', 'rounded', 'dots', 'mosaic', 'jitter-light', 'jitter-heavy'].includes(style)) {
    throw Error('Unsupported render style: ' + style);
  }
  renderTarget.setAttribute('viewBox', '0 0 ' + (bitmask.width + 2) + ' ' + (bitmask.height + 2));
  while(renderTarget.firstChild) {
    renderTarget.firstChild.remove();
  }
  let contours = qrsvg.calculateContour(bitmask, 1, style);
  for(let contourType in contours) {
    let path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', contours[contourType].join(''));
    // Add your customizations - e.g. `fill` colors, custom classes... - here.
    renderTarget.appendChild(path);
  }
}

qrsvg['Bitmask'] = Bitmask;
qrsvg['Contour'] = Contour;
qrsvg['PRNG'] = PRNG;
qrsvg['makePathSpecRound'] = makePathSpecRound;
qrsvg['addJitterToPathSpec'] = addJitterToPathSpec;
qrsvg['compactPathSpec'] = compactPathSpec;
qrsvg['calculateDotsOrMosaicContour'] = calculateDotsOrMosaicContour;
qrsvg['calculateShapeContour'] = calculateShapeContour;
qrsvg['calculateContour'] = calculateContour;
qrsvg['render'] = render;

})(qrsvg || (qrsvg = {}));
