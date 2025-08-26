git stash list
# If you see something like "stash@{0}: WIP – save all app files", preview and apply:
git stash show -p stash@{0} | less
git stash apply --index stash@{0}   # brings files back (may show conflicts)
git add -A
git commit -m "Add full cad4less-catalog app"
git push -u origin main