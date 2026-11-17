FROM node:24.18.1-alpine3.24 AS runtime
WORKDIR /opt/do-md
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY bin ./bin
COPY sources ./sources
COPY docs ./docs
COPY examples ./examples
COPY skills ./skills
COPY LICENSE README.md CHANGELOG.md ./
USER node
WORKDIR /workspace
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "/opt/do-md/bin/do-md.mjs"]
CMD ["serve", "--root", "/workspace", "--host", "0.0.0.0", "--port", "8080"]

# Verify the installed runtime, not a bind-mounted checkout. Development tools
# and the smoke script do not enter the final distribution stage.
FROM runtime AS verification
COPY scripts/image-smoke.mjs /opt/do-md/scripts/image-smoke.mjs
RUN node /opt/do-md/scripts/image-smoke.mjs

FROM runtime AS final
