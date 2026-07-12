FROM jerryenebeli/blnk:0.15.0
COPY blnk/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["sh", "-c", "blnk migrate up && blnk start"]
