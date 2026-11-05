// Cut the subject out of a picture with macOS Vision (the "lift subject" model), for logos on busy backgrounds.
// Usage: fgmask <input> <output.png> writes the picture at its full size with the background transparent.
// Exit 0: done; 2: no subject found; 1: the picture could not be read or written.
import CoreImage
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count == 3, let input = CIImage(contentsOf: URL(fileURLWithPath: args[1])) else { exit(1) }
let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: input)
do {
  try handler.perform([request])
  guard let result = request.results?.first, !result.allInstances.isEmpty else { exit(2) }
  let masked = try result.generateMaskedImage(ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: false)
  try CIContext().writePNGRepresentation(of: CIImage(cvPixelBuffer: masked), to: URL(fileURLWithPath: args[2]), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
} catch {
  exit(1)
}
