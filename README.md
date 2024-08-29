# QRSVG

This is a small JavaScript project to render a two-dimensional bitmask
(mostly assumed to be a QR code) with a fixed width and height to an SVG
element as a collection of SVG paths with defined purposes. The code
analyzes the bitmask geometrically and traces the contours of contiguous
shapes. It allows rendering QR codes in several stylized ways. Note that
this code does not contain an actual QR code creator – it expects to receive
the 2D QR code as a bitmask for its input. See the project website for a
demo and more information.

Version 1.0 – https://fietkau.software/qr
