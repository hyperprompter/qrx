https://www.reddit.com/r/Hyperprompting/comments/1uoaxso/a_hypertextual_operating_system_inspired_by_plan9/

# A Hypertextual Operating System inspired by Plan9

it's not really pure hypertext but it's built around Plan9's "everything is a file" mantra: https://en.wikipedia.org/wiki/Plan_9_from_Bell_Labs
it's also a more "real" operating system than what we are exploring here, though im not sure if it has been demonstrated to run on real hardware yet (maybe tho!). either way to run Patchwork you still need QEMU (a virtual machine) and for hyperprompting we just treat the browser as the bare metal
what got my attention about PatchworkOS is that it uses a symlinking protocol that strikes me as very hypertextual. for example the way they handle file transclusions is like this:
/sys/fs/concatfs/clone?targets=1,2,3,4
and other such operations. im also just inspired by their level of documentation which is what im trying to do with this sub too
here's a screenshot of my current hyperprompted desktop for comparison, the main difference is that this screenshot was generated from recursive hyperlinks, but yet the end users experience is similar: https://www.reddit.com/r/Hyperprompting/comments/1ulprhb/hyperprompting_kernel_v260702_getting_started/
in hyperprompting, the hyperlink is the pointer, the data, the context, and the prompt all at the same time