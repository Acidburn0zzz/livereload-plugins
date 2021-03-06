module Temple
  module Generators
    # Implements a string buffer.
    #
    #   _buf = ''
    #   _buf << "static"
    #   _buf << dynamic.to_s
    #   _buf
    #
    # @api public
    class StringBuffer < ArrayBuffer
      def preamble
        "#{buffer} = ''"
      end

      def postamble
        buffer
      end

      def on_dynamic(code)
        concat("(#{code}).to_s")
      end
    end
  end
end
